import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { LiveOrder, LiveOrderStatus } from '../types';

// --- Local Types (eventually move to types.ts) ---
export interface OrderItem {
    name: string;
    qty: number;
    price: number;
}

export interface BranchOrderHistory {
    orderId: string;
    date: string;
    time: string;
    items: OrderItem[];
    total: number;
    status: 'Completed' | 'Cancelled' | 'Processing';
    paymentMethod: 'Cash' | 'Card' | 'Online';
}

export interface BranchCustomer {
    id: string;
    name: string;
    email: string;
    phone: string;
    avatar: string;
    joinDate: string;
    totalOrders: number;
    totalSpent: number;
    lastInteraction: string | null;
    orders: BranchOrderHistory[];
}

export interface BranchStats {
    totalRevenue: number;
    totalOrders: number;
    avgOrderValue: number;
    satisfaction: number;
    revenueTrend: string;
    ordersTrend: string;
    hourlyData: { time: string; revenue: number; orders: number }[];
    topItems: { name: string; count: number }[];
    orderSources: { name: string; value: number; color: string }[];
}

export const useBranchDetails = (branchId?: string) => {
    const [customers, setCustomers] = useState<BranchCustomer[]>([]);
    const [liveOrders, setLiveOrders] = useState<LiveOrder[]>([]);
    const [allOrders, setAllOrders] = useState<any[]>([]);
    const [stats, setStats] = useState<BranchStats | null>(null);
    const [auditLogs, setAuditLogs] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);

    const fetchDetails = useCallback(async () => {
        if (!branchId) return;

        try {
            setLoading(true);

            // 1. Fetch Orders, Customers, and Profiles separately for resilience
            const [
                { data: dbOrders, error: ordersError },
                { data: dbCustomers, error: customersError },
                { data: dbProfiles, error: profilesError },
                { data: dbLogs, error: logsError }
            ] = await Promise.all([
                supabase.from('orders').select('*').eq('branch_id', branchId).order('created_at', { ascending: false }),
                supabase.from('customers').select('*'),
                supabase.from('profiles').select('*'),
                supabase.from('audit_logs').select('*').eq('branch_id', branchId).order('created_at', { ascending: false }).limit(50)
            ]);

            if (ordersError) throw ordersError;
            if (customersError) throw customersError;
            if (profilesError) throw profilesError;
            if (logsError) {
                console.warn('Audit logs fetch failed (maybe table missing):', logsError);
            }

            const customerMap = new Map<string, BranchCustomer>();

            // 1.5. Aggregate all unique customer IDs from orders to ensure they show up
            const allCustomerIdsFromOrders = new Set((dbOrders || []).map(o => o.customer_id).filter(id => !!id));

            // Process Registered Customers first
            (dbCustomers || []).forEach(c => {
                const p = (dbProfiles || []).find(profile => profile.id === c.id);
                customerMap.set(c.id, {
                    id: c.id,
                    name: p?.name || c.name || 'Anonymous User',
                    email: p?.email || c.email || 'no-email@placeholder.com',
                    phone: p?.phone || c.phone || '05X-XXX-XXXX',
                    avatar: p?.avatar_url || `https://ui-avatars.com/api/?name=${p?.name || 'User'}&background=random`,
                    joinDate: c.join_date || c.created_at?.split('T')[0] || new Date().toISOString().split('T')[0],
                    totalOrders: c.total_orders || 0,
                    totalSpent: c.total_spent || 0,
                    lastInteraction: c.last_interaction || c.created_at || null,
                    orders: []
                });
            });

            // Add Virtual Customers (those who placed orders but aren't in customers table yet)
            allCustomerIdsFromOrders.forEach(id => {
                if (!customerMap.has(id)) {
                    const p = (dbProfiles || []).find(profile => profile.id === id);
                    customerMap.set(id, {
                        id: id,
                        name: p?.name || 'Quick Order User',
                        email: p?.email || 'pending-link@bot.com',
                        phone: p?.phone || 'WhatsApp User',
                        avatar: p?.avatar_url || `https://ui-avatars.com/api/?name=User&background=random`,
                        joinDate: new Date().toISOString().split('T')[0],
                        totalOrders: 0,
                        totalSpent: 0,
                        lastInteraction: null,
                        orders: []
                    });
                }
            });

            // 2. Process Orders into LiveOrders, History, and Stats
            const currentLiveOrders: LiveOrder[] = [];
            let totalRevenue = 0;
            let totalOrders = 0;
            const itemCounts: Record<string, number> = {};
            const hourlyMap: Record<string, { revenue: number; orders: number }> = {};
            const sourceCounts: Record<string, number> = { 'Mobile App': 0, 'Voice AI': 0, 'Walk-in': 0, 'WhatsApp Bot': 0 };

            // Initialize 24 hours for chart
            for (let i = 0; i < 24; i++) {
                hourlyMap[`${i}:00`] = { revenue: 0, orders: 0 };
            }

            (dbOrders || []).forEach((order: any) => {
                const customer = customerMap.get(order.customer_id);

                // Update stats from orders dynamically (Reliable source of truth)
                if (customer) {
                    if (order.status !== 'Cancelled') {
                        customer.totalOrders += 1;
                        customer.totalSpent += order.total;

                        // Set lastInteraction to the most recent order date
                        const orderTime = new Date(order.created_at).getTime();
                        if (!customer.lastInteraction || orderTime > new Date(customer.lastInteraction).getTime()) {
                            customer.lastInteraction = order.created_at;
                        }
                    }
                }

                const orderDate = new Date(order.created_at);
                const hourKey = `${orderDate.getHours()}:00`;

                // Calculate Stats (Exclude cancelled for revenue)
                if (order.status !== 'Cancelled') {
                    totalRevenue += order.total;
                    totalOrders += 1;

                    if (hourlyMap[hourKey]) {
                        hourlyMap[hourKey].revenue += order.total;
                        hourlyMap[hourKey].orders += 1;
                    }

                    // Source Mapping
                    if (order.mode === 'Voice') sourceCounts['Voice AI'] += 1;
                    else if (order.mode === 'Text') sourceCounts['WhatsApp Bot'] += 1;
                    else sourceCounts['Walk-in'] += 1;

                    // Item Stats
                    (order.items || []).forEach((item: any) => {
                        itemCounts[item.name] = (itemCounts[item.name] || 0) + (item.qty || 1);
                    });
                }

                // Live Orders (Pending/Preparing/Ready)
                if (['Pending', 'Preparing', 'Ready'].includes(order.status)) {
                    currentLiveOrders.push({
                        id: order.id,
                        customerName: customer?.name || 'Guest',
                        customerAvatar: customer?.avatar || 'https://i.pravatar.cc/150?u=guest',
                        items: (order.items || []).map((i: any) => ({
                            ...i, // Pass through chefId, status, timestamps
                            name: i.name || i.name_en,
                            qty: i.qty
                        })),
                        total: order.total,
                        status: order.status as LiveOrderStatus,
                        timestamp: new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                        elapsedMinutes: Math.floor((Date.now() - new Date(order.created_at).getTime()) / 60000)
                    });
                }

                // Attach to Customer History
                if (order.customer_id && customer) {
                    customer.orders.push({
                        orderId: order.order_number || order.id.slice(0, 8),
                        date: order.created_at.split('T')[0],
                        time: new Date(order.created_at).toLocaleTimeString(),
                        items: (order.items || []).map((i: any) => ({
                            name: i.name || i.name_en || 'Item',
                            qty: i.qty || 1,
                            price: i.price || 0
                        })),
                        total: order.total,
                        status: (order.status === 'Completed' ? 'Completed' : order.status === 'Cancelled' ? 'Cancelled' : 'Processing') as any,
                        paymentMethod: (order.payment_method as any) || 'Cash'
                    });
                }
            });

            // Format Stats for UI
            const topItems = Object.entries(itemCounts)
                .map(([name, count]) => ({ name, count }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 5);

            const orderSources = Object.entries(sourceCounts)
                .map(([name, value]) => ({
                    name,
                    value,
                    color: name === 'WhatsApp Bot' ? '#10b981' : (name === 'Voice AI' ? '#f97316' : (name === 'Mobile App' ? '#0ea5e9' : '#8b5cf6'))
                }))
                .filter(s => s.value > 0);

            const hourlyData = Object.entries(hourlyMap).map(([time, data]) => ({
                time,
                ...data
            }));

            setStats({
                totalRevenue,
                totalOrders,
                avgOrderValue: totalOrders > 0 ? totalRevenue / totalOrders : 0,
                satisfaction: 4.8, // Placeholder until review system is live
                revenueTrend: '+12%', // Logic for historical comparison can be added
                ordersTrend: '+5%',
                hourlyData,
                topItems,
                orderSources
            });

            setLiveOrders(currentLiveOrders);
            setAllOrders(dbOrders || []);

            // Sort customers: Latest interaction (or join date) first
            const sortedCustomers = Array.from(customerMap.values()).sort((a, b) => {
                const dateA = new Date(a.lastInteraction || a.joinDate).getTime();
                const dateB = new Date(b.lastInteraction || b.joinDate).getTime();
                return dateB - dateA;
            });

            setCustomers(sortedCustomers);
            setAuditLogs(dbLogs || []);

        } catch (error) {
            console.error('Error fetching branch details:', error);
        } finally {
            setLoading(false);
        }
    }, [branchId]);

    useEffect(() => {
        fetchDetails();

        if (!branchId) return;

        // 3. Real-time Subscription
        const ordersChannel = supabase
            .channel(`branch-orders-${branchId}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'orders',
                    filter: `branch_id=eq.${branchId}`
                },
                () => {
                    console.log('Real-time update received for orders, refreshing...');
                    fetchDetails();
                }
            )
            .subscribe();

        const customersChannel = supabase
            .channel('public-customers')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'customers' }, () => fetchDetails())
            .subscribe();

        const profilesChannel = supabase
            .channel('public-profiles')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => fetchDetails())
            .subscribe();

        return () => {
            supabase.removeChannel(ordersChannel);
            supabase.removeChannel(customersChannel);
            supabase.removeChannel(profilesChannel);
        };
    }, [fetchDetails, branchId]);

    return { customers, liveOrders, allOrders, stats, auditLogs, loading, refreshDetails: fetchDetails };
};
