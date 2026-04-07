import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Branch, MenuItem, LiveOrder, LiveOrderStatus, TimeRange, AvailabilityStatus, OperationalHours } from '../types';
import { supabase } from '../lib/supabase';
import {
    MapPin, User, MoreVertical, Plus, ArrowRight, ArrowLeft, Phone, Search,
    Edit, Trash2, FileText, Save, X, Filter, Briefcase, Users,
    Receipt, Calendar, Clock, CheckCircle2, XCircle, ShoppingBag, ChevronRight, Mail,
    CalendarDays, Download, RefreshCcw, Banknote, CreditCard, Truck, ChefHat, Package,
    UtensilsCrossed, Printer, Share2, SlidersHorizontal, ChevronDown, ArrowUp, ArrowDown,
    TrendingUp, Activity, Bot, Mic, Star, Zap, Server, Percent, ArrowUpRight, ArrowDownRight, AlertTriangle, Loader2, Upload, DollarSign
} from 'lucide-react';
import { ExcelUploadService, ExcelMenuItem } from '../services/ExcelUploadService';

import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer,
    BarChart, Bar, PieChart, Pie, Cell, Legend
} from 'recharts';
import { read, utils } from 'xlsx';
import { DEFAULT_BRANCH_SETTINGS } from '../constants';
import { StaffRole, StaffMember } from '../types';
import StaffDetailView from './StaffDetailView';
import { syncService } from '../services/SyncService';
import { useAuth } from '../contexts/AuthContext';
import { useBranchDetails, BranchCustomer, BranchOrderHistory } from '../hooks/useBranchDetails';
import KitchenDetailModal from './KitchenDetailModal';
import ReportsDashboard from './ReportsDashboard';
import { ReportsService } from '../services/ReportsService';



// --- Mock Data Removed (Replaced by useBranchDetails hook) ---

const generateBranchOverviewData = (range: TimeRange) => {
    let points = (range === 'Today' || range === 'Yesterday') ? 12 : range === 'Last Week' ? 7 : 15;
    const hourlyData = Array.from({ length: points }, (_, i) => ({
        time: (range === 'Today' || range === 'Yesterday') ? `${10 + i}:00` : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i % 7] || `Day ${i + 1}`,
        orders: Math.floor(Math.random() * 50) + 10,
        revenue: Math.floor(Math.random() * 1000) + 200,
    }));

    const topItems = [
        { name: 'Zinger Burger', count: 145 },
        { name: 'Cheese Fries', count: 98 },
        { name: 'Pepsi', count: 210 },
        { name: 'Family Meal', count: 65 },
        { name: 'Wrap', count: 112 },
    ];

    const orderSource = [
        { name: 'Mobile App', value: 65, color: '#0ea5e9' },
        { name: 'Voice AI', value: 25, color: '#f97316' },
        { name: 'Walk-in', value: 10, color: '#8b5cf6' },
    ];

    return { hourlyData, topItems, orderSource };
};

const formatCurrency = (amount: number) => {
    return {
        sar: new Intl.NumberFormat('en-SA', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount),
        usd: new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount / 3.75)
    };
};

// --- 3D Animation Hook for Cards ---
const use3DTilt = () => {
    const ref = useRef<HTMLDivElement>(null);
    const [style, setStyle] = useState({});

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!ref.current) return;
        const rect = ref.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        const rotateX = ((y - centerY) / centerY) * -10;
        const rotateY = ((x - centerX) / centerX) * 10;

        setStyle({
            transform: `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.02, 1.02, 1.02)`,
            transition: 'transform 0.1s ease-out'
        });
    };

    const handleMouseLeave = () => {
        setStyle({
            transform: 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)',
            transition: 'transform 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
        });
    };

    return { ref, style, handleMouseMove, handleMouseLeave };
};

interface BranchManagerProps {
    branches: Branch[];
    onDeleteBranch: (id: string) => void;
    onUpdateBranchMenu: (branchId: string, updatedMenu: MenuItem[]) => void;
    onAddBranch: (newBranch: Branch) => void;
    onUpdateBranch?: (updatedBranch: Branch) => void;
    preSelectedBranchId?: string | null;
    isReadOnly?: boolean;
    initialTab?: 'OVERVIEW' | 'MENU' | 'CUSTOMERS' | 'SETTINGS' | 'STAFF' | 'REPORTS';
    hideTabs?: boolean;
    allowAddBranch?: boolean;
    onRequestRestock?: (item: MenuItem) => void;
}

const BranchManager: React.FC<BranchManagerProps> = ({
    branches,
    onDeleteBranch,
    onUpdateBranchMenu,
    onAddBranch,
    onUpdateBranch,
    preSelectedBranchId,
    isReadOnly = false,
    initialTab = 'OVERVIEW',
    hideTabs = false,
    allowAddBranch = true,
    onRequestRestock
}) => {
    const [selectedBranchId, setSelectedBranchId] = useState<string | null>(preSelectedBranchId || null);
    const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'OVERVIEW' | 'MENU' | 'CUSTOMERS' | 'STAFF' | 'SETTINGS' | 'REPORTS'>(initialTab);

    // Bulk Upload State
    const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadStatus, setUploadStatus] = useState<'idle' | 'parsing' | 'syncing' | 'success' | 'error'>('idle');
    const [errorMessage, setErrorMessage] = useState('');
    const [detectedCategories, setDetectedCategories] = useState<string[]>([]);

    const [selectedKitchenOrder, setSelectedKitchenOrder] = useState<LiveOrder | null>(null);
    console.log('DEBUG: BranchManager Render. selectedKitchenOrder:', selectedKitchenOrder?.id);

    const { userRole, user } = useAuth();
    // --- Real Data Hook ---
    const { customers: fetchedCustomers, liveOrders: fetchedLiveOrders, allOrders: fetchedAllOrders, stats: fetchedStats, auditLogs: fetchedLogs, refreshDetails } = useBranchDetails(selectedBranchId || undefined);

    const handleBulkUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !selectedBranch) return;

        try {
            setIsUploading(true);
            setUploadStatus('parsing');

            // 1. Parse File
            const items = await ExcelUploadService.parseFile(file);
            if (items.length === 0) throw new Error('No valid menu items found in the file.');

            setUploadStatus('syncing');

            // 2. Clear Existing Data (as requested)
            if (window.confirm('Wipe current menu data and replace with Excel data? This cannot be undone.')) {
                console.log('Cleaning up existing menu data...');
                // Delete modifiers first (foreign key constraint)
                await supabase.from('menu_item_modifiers').delete().neq('id', '00000000-0000-0000-0000-000000000000');

                // Delete items for this branch OR orphans (like mock data)
                const { error: deleteError } = await supabase.from('menu_items')
                    .delete()
                    .or(`branch_id.eq.${selectedBranch.id},branch_id.is.null`);

                if (deleteError) {
                    console.error('Cleanup Error:', deleteError);
                    alert('Warning: Cleanup was partial. Some items might remain.');
                } else {
                    console.log('Database cleaned successfully.');
                }
            }

            // 3. Sync
            const result = await ExcelUploadService.uploadToDatabase(items, selectedBranch.id);
            setDetectedCategories(result.categories || []);

            setUploadStatus('success');
            setTimeout(() => {
                setIsUploadModalOpen(false);
                setUploadStatus('idle');
                window.location.reload();
            }, 2000);

        } catch (err: any) {
            setUploadStatus('error');
            setErrorMessage(err.message || 'Bulk upload failed.');
            console.error(err);
        } finally {
            setIsUploading(false);
        }
    };
    const logAction = (action: any, details: string) => {
        if (!user) return;
        syncService.broadcastAuditLog({
            id: Date.now().toString(),
            userName: user.name,
            userRole: userRole!,
            branchId: selectedBranchId || undefined,
            action,
            details,
            timestamp: new Date().toISOString(),
            status: 'Success'
        });
    };



    useEffect(() => {
        console.log('--- BranchManager: branches prop ---', branches);
        setBranchesList(branches);
    }, [branches]);




    // Sync active tab when initialTab or preSelectedBranchId changes
    useEffect(() => {
        setActiveTab(initialTab);
        if (preSelectedBranchId) setSelectedBranchId(preSelectedBranchId);
    }, [initialTab, preSelectedBranchId]);

    // Sync branchesList with prop to reflect parent updates (e.g. Menu Item added)
    useEffect(() => {
        setBranchesList(branches);
    }, [branches]);

    const [branchesList, setBranchesList] = useState<Branch[]>(branches);
    const [branchSearch, setBranchSearch] = useState('');
    const [customers, setCustomers] = useState<BranchCustomer[]>([]);
    const [customerSearch, setCustomerSearch] = useState('');
    const [selectedCustomer, setSelectedCustomer] = useState<BranchCustomer | null>(null);
    const [isEditCustomerModalOpen, setIsEditCustomerModalOpen] = useState(false);
    const [editCustomerForm, setEditCustomerForm] = useState<Partial<BranchCustomer>>({});
    const [customerSort, setCustomerSort] = useState<'newest' | 'oldest' | 'spent_high' | 'orders_high'>('newest');
    const [isSortDropdownOpen, setIsSortDropdownOpen] = useState(false);
    const [dbCategories, setDbCategories] = useState<{ id: string; name_en: string }[]>([]);

    useEffect(() => {
        const fetchCats = async () => {
            const { data } = await supabase.from('menu_categories').select('id, name_en').order('name_en');
            if (data) setDbCategories(data);
        };
        fetchCats();
    }, []);

    // --- Order History Filter & Detail State ---
    const [historyFilter, setHistoryFilter] = useState<'All' | 'Today' | 'Yesterday' | 'Custom'>('All');
    const [customHistoryDate, setCustomHistoryDate] = useState('');
    const [selectedOrder, setSelectedOrder] = useState<BranchOrderHistory | null>(null);

    // --- Menu State ---
    const [menuSearch, setMenuSearch] = useState('');
    const [selectedCategory, setSelectedCategory] = useState<string>('All');
    const [selectedSubcategory, setSelectedSubcategory] = useState<string | null>(null);
    const [editingItemKey, setEditingItemKey] = useState<string | null>(null);
    const [editForm, setEditForm] = useState<Partial<MenuItem>>({});
    const [customerFilter, setCustomerFilter] = useState<'all' | 'inactive_5' | 'inactive_10' | 'inactive_20' | 'inactive_30' | 'inactive_45' | 'inactive_60' | 'inactive_90' | 'custom'>('all');
    const [customerInactivityRange, setCustomerInactivityRange] = useState({ start: '', end: '' });
    const [isFilterDropdownOpen, setIsFilterDropdownOpen] = useState(false);
    const [customerSubTab, setCustomerSubTab] = useState<'USERS' | 'CAMPAIGNS'>('USERS');
    const [campaigns, setCampaigns] = useState<any[]>([]);
    const [isLoadingCampaigns, setIsLoadingCampaigns] = useState(false);

    // Compute categories dynamically from menu
    const categories = useMemo(() => {
        if (!selectedBranchId) return ['All'];
        const branch = branchesList.find(b => b.id === selectedBranchId);
        if (!branch) return ['All'];
        const cats = ['All', ...Array.from(new Set(branch.menu.map((item: any) => item.category)))];
        return cats;
    }, [selectedBranchId, branchesList]);

    // Compute subcategories based on selected category
    const subcategories = useMemo(() => {
        console.log('🔍 Computing subcategories for category:', selectedCategory);
        if (!selectedBranchId || selectedCategory === 'All') {
            console.log('❌ Returning empty - category is All or no branch selected');
            return [];
        }
        const branch = branchesList.find(b => b.id === selectedBranchId);
        if (!branch) {
            console.log('❌ No branch found');
            return [];
        }
        console.log('📋 Total menu items:', branch.menu.length);
        const categoryItems = branch.menu.filter((item: any) => item.category === selectedCategory);
        console.log('📋 Items in category:', categoryItems.length);
        const subs = categoryItems
            .map((item: any) => {
                console.log('  - Item:', item.name_en, '| Subcategory:', item.subcategory);
                return item.subcategory;
            })
            .filter((sub: any): sub is string => !!sub);
        const uniqueSubs = ['All', ...Array.from(new Set(subs))];
        console.log('✅ Final subcategories:', uniqueSubs);
        return uniqueSubs;
    }, [selectedBranchId, branchesList, selectedCategory]);

    // --- Campaign Data Fetching ---
    useEffect(() => {
        if (activeTab === 'CUSTOMERS' && customerSubTab === 'CAMPAIGNS') {
            fetchCampaigns();
        }
    }, [activeTab, customerSubTab, selectedBranchId]);

    const fetchCampaigns = async () => {
        if (!selectedBranchId) return;
        setIsLoadingCampaigns(true);
        try {
            const { data, error } = await supabase
                .from('campaign_analytics')
                .select('*')
                .eq('branch_id', selectedBranchId)
                .order('created_at', { ascending: false });

            if (error) throw error;
            setCampaigns(data || []);
        } catch (err) {
            console.error('Error fetching campaigns:', err);
        } finally {
            setIsLoadingCampaigns(false);
        }
    };

    // Compute filtered menu
    const filteredMenu = useMemo(() => {
        if (!selectedBranchId) return [];
        const branch = branchesList.find(b => b.id === selectedBranchId);
        if (!branch) return [];

        return branch.menu.filter((item: any) => {
            // Category filter
            if (selectedCategory !== 'All' && item.category !== selectedCategory) return false;

            // Subcategory filter
            if (selectedSubcategory && selectedSubcategory !== 'All' && item.subcategory !== selectedSubcategory) return false;

            // Search filter
            if (menuSearch && !item.name_en.toLowerCase().includes(menuSearch.toLowerCase())) return false;

            return true;
        });
    }, [selectedBranchId, branchesList, selectedCategory, selectedSubcategory, menuSearch]);


    // --- Modals State ---
    const [isAddItemModalOpen, setIsAddItemModalOpen] = useState(false);
    const [newItemForm, setNewItemForm] = useState<Partial<MenuItem & { category_id: string, cuisine_type: string, available_meals: string[] }>>({
        category: '',
        category_id: '',
        subcategory: '',
        price: 0,
        cuisine_type: 'General',
        available_meals: ['Lunch', 'Dinner']
    });
    const [isAddBranchModalOpen, setIsAddBranchModalOpen] = useState(false);
    const [newBranchData, setNewBranchData] = useState({
        name: '', email: '', address: '', manager: '', phone: '', ownerName: '', ownerEmail: '', ownerPhone: '', ownerUsername: '', ownerPassword: ''
    });

    const [selectedStaff, setSelectedStaff] = useState<StaffMember | null>(null);

    // Staff Management State
    const [isAddStaffModalOpen, setIsAddStaffModalOpen] = useState(false);
    const [newStaffForm, setNewStaffForm] = useState<Partial<StaffMember>>({
        role: StaffRole.CASHIER,
        status: 'Active',
        shift: { start: '09:00', end: '17:00', days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], type: 'Morning' },
        financials: { salary: 3000, paidThisMonth: 0, pendingAmount: 0, bonuses: 0, penalties: 0 } as any
    });

    // --- Handlers ---
    const handleAddStaff = async () => {
        if (!selectedBranch || !newStaffForm.name) return;

        // 1. Prepare for Supabase (Snake Case)
        const staffToInsert = {
            branch_id: selectedBranch.id,
            name: newStaffForm.name,
            role: newStaffForm.role || StaffRole.CASHIER,
            email: newStaffForm.email || '',
            phone: newStaffForm.phone || '',
            status: 'Active',
            join_date: new Date().toISOString().split('T')[0],
            base_salary: newStaffForm.financials?.salary || 3000,
            currency: 'SAR',
            shift_start: newStaffForm.shift?.start || '09:00',
            shift_end: newStaffForm.shift?.end || '17:00',
            shift_days: newStaffForm.shift?.days || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
            shift_type: 'Morning',
            avatar_url: `https://ui-avatars.com/api/?name=${newStaffForm.name}&background=random`
        };

        const { data, error } = await supabase
            .from('staff_members')
            .insert(staffToInsert)
            .select()
            .single();

        if (error) {
            console.error("Error adding staff:", error);
            alert("Failed to add staff to database.");
            return;
        }

        // 2. Map back to StaffMember type
        const newStaff: StaffMember = {
            id: data.id,
            name: data.name,
            role: data.role as StaffRole,
            avatar: data.avatar_url || '',
            email: data.email || '',
            phone: data.phone || '',
            joinDate: data.join_date,
            status: data.status,
            shift: {
                start: data.shift_start?.slice(0, 5) || '09:00',
                end: data.shift_end?.slice(0, 5) || '17:00',
                days: data.shift_days || [],
                type: data.shift_type || 'Morning'
            },
            metrics: {
                lifetimeOrders: 0, ordersToday: 0, ordersThisWeek: 0, avgOrdersPerShift: 0,
                avgPrepTime: 0, fastestPrep: 0, slowestPrep: 0, peakHourPerformance: 0,
                successRate: 100, delayedOrders: 0, reassignedOrders: 0, mistakes: 0,
                cancellationByStaff: 0, customerSatisfaction: 5, rating: 5, wastageIncidents: 0, estimatedLoss: 0
            },
            financials: {
                salary: data.base_salary, currency: data.currency, paidThisMonth: 0,
                pendingAmount: 0, bonuses: 0, penalties: 0, history: []
            },
            attendance: [], performanceHistory: [], documents: [],
            systemAccess: { lastActive: new Date().toISOString(), permissions: [], recentActions: [] }
        };

        const updatedStaff = [...(selectedBranch.staff || []), newStaff];
        if (onUpdateBranch) {
            onUpdateBranch({ ...selectedBranch, staff: updatedStaff });
        }

        // Sync & Log
        syncService.broadcastStaffUpdate(selectedBranch.id, updatedStaff);
        logAction('CREATE', `Added new staff member: ${newStaff.name} (${newStaff.role})`);

        setIsAddStaffModalOpen(false);
        setNewStaffForm({
            role: StaffRole.CASHIER,
            status: 'Active',
            shift: { start: '09:00', end: '17:00', days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], type: 'Morning' },
            financials: { salary: 3000, paidThisMonth: 0, pendingAmount: 0, bonuses: 0, penalties: 0 } as any
        });
    };

    // --- Overview State ---
    const [timeRange, setTimeRange] = useState<TimeRange>('Today');
    const [customDate, setCustomDate] = useState({ start: '', end: '' });
    const [overviewData, setOverviewData] = useState<ReturnType<typeof generateBranchOverviewData> | null>(null);
    const [liveOrders, setLiveOrders] = useState<LiveOrder[]>([]);
    const [isCustomPickerOpen, setIsCustomPickerOpen] = useState(false);



    // --- Sync Hook Data to Local State ---
    useEffect(() => {
        if (fetchedLiveOrders) setLiveOrders(fetchedLiveOrders);
    }, [fetchedLiveOrders]);

    useEffect(() => {
        if (fetchedStats) {
            setOverviewData({
                hourlyData: fetchedStats.hourlyData,
                topItems: fetchedStats.topItems,
                orderSource: fetchedStats.orderSources
            });
        }
    }, [fetchedStats]);

    useEffect(() => {
        if (fetchedCustomers) setCustomers(fetchedCustomers);
    }, [fetchedCustomers]);

    const updateOrderStatus = async (orderId: string, newStatus: LiveOrderStatus) => {
        console.log(`[DEBUG] Starting Update for Order: ${orderId} -> ${newStatus}`);

        // 1. Check Real Auth Session
        const { data: { session } } = await supabase.auth.getSession();
        console.log('[DEBUG] Current Session User:', session?.user?.id || 'NO SESSION');

        if (!session?.user) {
            alert("CRITICAL ERROR: You are not signed into Supabase. The UI is showing cached login data. Please Log Out and Log In again.");
            refreshDetails();
            return;
        }

        // Optimistic Update
        setLiveOrders(prev => prev.map(order =>
            order.id === orderId ? { ...order, status: newStatus } : order
        ));

        try {
            // 2. Pre-Check: Does order exist?
            const { data: existingOrder, error: fetchError } = await supabase
                .from('orders')
                .select('id, status, customer_id')
                .eq('id', orderId)
                .single();

            if (fetchError || !existingOrder) {
                console.error('[DEBUG] Order NOT FOUND in DB:', fetchError);
                alert(`Order ID mismatch! DB cannot find order #${orderId}`);
                throw new Error("Order not found");
            }

            console.log('[DEBUG] Order found:', existingOrder);

            // 3. Perform Update
            const { data, error } = await supabase
                .from('orders')
                .update({ status: newStatus })
                .eq('id', orderId)
                .select();

            if (error) {
                console.error('[DEBUG] UPDATE FAILED:', error);
                alert(`Update Failed: ${error.message}`);
                throw error;
            }

            if (!data || data.length === 0) {
                console.error('[DEBUG] RLS BLOCKING: Update returned 0 rows.');
                alert("PERMISSION DENIED: Database blocked this update. Row Level Security (RLS) is preventing changes. Check 'profiles' table for your role.");
            } else {
                console.log('[DEBUG] Update SUCCESS:', data);
            }

            // Broadcast Status
            if (selectedBranch) {
                syncService.broadcastOrderUpdate(selectedBranch.id, orderId, newStatus);
                logAction('ORDER_MOD', `Order #${orderId} status updated to ${newStatus}`);
            }
        } catch (err) {
            console.error('Failed to update status:', err);
            refreshDetails();
        }

        if (newStatus === LiveOrderStatus.COMPLETED) {
            // DEDUCT STOCK
            const order = liveOrders.find(o => o.id === orderId);
            if (order && selectedBranch) {
                const updatedMenu = selectedBranch.menu.map(item => {
                    const orderedItem = order.items.find(oi => oi.name === item.name_en);
                    if (orderedItem) {
                        const newStock = Math.max(0, (item.stock || 0) - orderedItem.qty);

                        // Stock Alert if low
                        if (newStock < (item.minStockThreshold || 5)) {
                            syncService.broadcastStockAlert(selectedBranch.id, item.key, newStock);
                        }

                        return {
                            ...item,
                            stock: newStock,
                            isOutOfStock: newStock === 0
                        };
                    }
                    return item;
                });
                onUpdateBranchMenu(selectedBranch.id, updatedMenu);
                syncService.broadcastMenuUpdate(selectedBranch.id, updatedMenu);
            }

            setTimeout(() => {
                setLiveOrders(prev => prev.filter(o => o.id !== orderId));
            }, 3000);
        }
    };

    // --- Kitchen Detail Update ---
    const handleKitchenUpdate = async (orderId: string, updates: Partial<LiveOrder>) => {
        if (selectedKitchenOrder?.id === orderId) {
            setSelectedKitchenOrder(prev => prev ? { ...prev, ...updates } : null);
        }

        setLiveOrders(prev => prev.map(o => o.id === orderId ? { ...o, ...updates } : o));

        try {
            const { error } = await supabase
                .from('orders')
                .update(updates)
                .eq('id', orderId);

            if (error) throw error;

            if (updates.status) {
                syncService.broadcastOrderUpdate(selectedBranch?.id || '', orderId, updates.status);
            }
        } catch (err) {
            console.error('Kitchen update failed', err);
            refreshDetails();
        }
    };

    // Derived State
    const selectedBranch = useMemo(() => branchesList.find(b => b.id === selectedBranchId) || null, [branchesList, selectedBranchId]);

    // Inventory Analysis
    const lowStockItems = useMemo(() =>
        selectedBranch ? selectedBranch.menu.filter(item => item.stock <= (item.minStockThreshold || 5)) : [],
        [selectedBranch]
    );

    const filteredBranches = useMemo(() => {
        return branchesList.filter(b =>
            b.name.toLowerCase().includes(branchSearch.toLowerCase()) ||
            b.location.toLowerCase().includes(branchSearch.toLowerCase()) ||
            b.manager.toLowerCase().includes(branchSearch.toLowerCase())
        );
    }, [branchesList, branchSearch]);

    // Sync branchesList with props when they change
    useEffect(() => {
        setBranchesList(branches);
    }, [branches]);

    // Load Customers & Overview Data when branch opens or time range changes
    // Load Overview Data (Mock for now, Customers handled by hook)
    // Load Overview Data (Mock for now, Customers handled by hook)
    // Load Overview Data (Mock for now, Customers handled by hook)
    // Load Overview Data (Mock for now, Customers handled by hook)
    useEffect(() => {
        if (selectedBranchId) {
            setOverviewData(generateBranchOverviewData(timeRange));
            if (!overviewData) setActiveTab('OVERVIEW'); // Only reset on initial load
        }
    }, [selectedBranchId, timeRange, customDate]);

    // Filtered Orders Logic
    const filteredOrders = useMemo(() => {
        if (!selectedCustomer) return [];
        let data = selectedCustomer.orders;
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];

        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];

        if (historyFilter === 'Today') {
            data = data.filter(o => o.date === todayStr);
        } else if (historyFilter === 'Yesterday') {
            data = data.filter(o => o.date === yesterdayStr);
        } else if (historyFilter === 'Custom' && customHistoryDate) {
            data = data.filter(o => o.date === customHistoryDate);
        }
        return data;
    }, [selectedCustomer, historyFilter, customHistoryDate]);

    const filteredCustomers = useMemo(() => {
        let result = customers.filter(c => {
            // 1. Search Filter
            const matchesSearch = c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
                c.phone.includes(customerSearch) ||
                c.email.toLowerCase().includes(customerSearch);

            if (!matchesSearch) return false;

            if (customerFilter === 'custom') {
                const lastDateStr = c.lastInteraction || c.joinDate;
                if (lastDateStr && customerInactivityRange.start && customerInactivityRange.end) {
                    const lastDate = new Date(lastDateStr).getTime();
                    const startDate = new Date(customerInactivityRange.start).getTime();
                    const endDate = new Date(customerInactivityRange.end).getTime();
                    if (lastDate < startDate || lastDate > endDate) return false;
                }
            } else if (customerFilter !== 'all') {
                const now = new Date();
                const daysMap: any = {
                    'inactive_5': 5, 'inactive_10': 10, 'inactive_20': 20,
                    'inactive_30': 30, 'inactive_45': 45, 'inactive_60': 60, 'inactive_90': 90
                };
                const daysThreshold = daysMap[customerFilter];

                const lastDateStr = c.lastInteraction || c.joinDate;
                if (lastDateStr) {
                    const lastDate = new Date(lastDateStr);
                    const diffTime = Math.abs(now.getTime() - lastDate.getTime());
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                    if (diffDays <= daysThreshold) return false;
                }
            }
            return true;
        });

        // Apply Sorting
        switch (customerSort) {
            case 'spent_high':
                result = [...result].sort((a, b) => b.totalSpent - a.totalSpent);
                break;
            case 'orders_high':
                result = [...result].sort((a, b) => b.totalOrders - a.totalOrders);
                break;
            case 'oldest':
                result = [...result].sort((a, b) => new Date(a.joinDate).getTime() - new Date(b.joinDate).getTime());
                break;
            case 'newest':
            default:
                result = [...result].sort((a, b) => new Date(b.joinDate).getTime() - new Date(a.joinDate).getTime());
                break;
        }
        return result;
    }, [customers, customerSearch, customerSort, customerFilter, customerInactivityRange]);

    const filteredStats = useMemo(() => {
        return {
            count: filteredCustomers.length,
            totalSpent: filteredCustomers.reduce((sum, c) => sum + (c.totalSpent || 0), 0),
            totalOrders: filteredCustomers.reduce((sum, c) => sum + (c.totalOrders || 0), 0)
        };
    }, [filteredCustomers]);

    // Menu Handlers
    const handleEditClick = (item: MenuItem) => { setEditingItemKey(item.key); setEditForm(item); };
    const handleCancelEdit = () => { setEditingItemKey(null); setEditForm({}); };
    const handleSaveEdit = async () => {
        if (!selectedBranch || !editingItemKey) return;

        try {
            // 1. Update in DB
            const { error } = await supabase
                .from('menu_items')
                .update({
                    name_en: editForm.name_en,
                    name_ar: editForm.name_ar,
                    price: editForm.price,
                    category_id: editForm.category_id,
                    subcategory: editForm.subcategory,
                    available_meals: editForm.availableMeals,
                    cuisine_type: editForm.cuisineType
                })
                .eq('id', editingItemKey);

            if (error) {
                console.error('Error updating item:', error);
                alert('Failed to save changes data.');
                return;
            }

            // 2. Update Local State
            const catObj = dbCategories.find(c => c.id === editForm.category_id);
            const updatedMenu = selectedBranch.menu.map(item =>
                item.key === editingItemKey ? {
                    ...item,
                    ...editForm,
                    category: catObj?.name_en || item.category
                } as MenuItem : item
            );
            onUpdateBranchMenu(selectedBranch.id, updatedMenu);

            // 3. Sync
            syncService.broadcastMenuUpdate(selectedBranch.id, updatedMenu);

            setEditingItemKey(null);
            setEditForm({});
        } catch (err) {
            console.error('Save failed:', err);
        }
    };
    const handleDeleteItem = async (key: string) => {
        if (!selectedBranch) return;
        if (window.confirm('Remove item permanently?')) {
            try {
                // 1. Delete from DB
                const { error } = await supabase
                    .from('menu_items')
                    .delete()
                    .eq('id', key); // key is mapped to id

                if (error) {
                    throw error;
                }

                // 2. Local Update
                const updatedMenu = selectedBranch.menu.filter(item => item.key !== key);
                onUpdateBranchMenu(selectedBranch.id, updatedMenu);

                // 3. Sync
                syncService.broadcastMenuUpdate(selectedBranch.id, updatedMenu);
            } catch (err: any) {
                console.error('Delete failed:', err);
                alert('Failed to delete item: ' + err.message);
            }
        }
    };
    const handleAddItem = async () => {
        if (!selectedBranch) return;
        if (!newItemForm.name_en || !newItemForm.price || !newItemForm.category_id) {
            alert("Missing required fields: Category, Name (EN), and Price are required.");
            return;
        }

        try {
            const dbItem = {
                branch_id: selectedBranch.id,
                category_id: newItemForm.category_id,
                subcategory: newItemForm.subcategory || null,
                name_en: newItemForm.name_en,
                name_ar: newItemForm.name_ar || newItemForm.name_en,
                price: Number(newItemForm.price),
                stock: 100,
                status: 'Available',
                min_stock_threshold: 10,
                available_meals: newItemForm.available_meals,
                cuisine_type: newItemForm.cuisine_type
            };

            const { data, error } = await supabase
                .from('menu_items')
                .insert(dbItem)
                .select()
                .single();

            if (error) throw error;

            // Find category name for local state
            const catObj = dbCategories.find(c => c.id === newItemForm.category_id);

            const newItem: MenuItem = {
                id: data.id,
                key: data.id,
                category: catObj?.name_en || 'Other',
                category_id: data.category_id,
                subcategory: data.subcategory,
                name_en: data.name_en,
                name_ar: data.name_ar,
                price: data.price,
                status: AvailabilityStatus.AVAILABLE,
                stock: data.stock,
                minStockThreshold: data.min_stock_threshold,
                availableMeals: data.available_meals,
                cuisineType: data.cuisine_type
            };

            const updatedMenu = [...selectedBranch.menu, newItem];
            onUpdateBranchMenu(selectedBranch.id, updatedMenu);
            syncService.broadcastMenuUpdate(selectedBranch.id, updatedMenu);

            setIsAddItemModalOpen(false);
            setNewItemForm({
                category: '',
                category_id: '',
                subcategory: '',
                price: 0,
                cuisine_type: 'General',
                available_meals: ['Lunch', 'Dinner']
            });

        } catch (err: any) {
            console.error('Add failed:', err);
            alert('Failed to add item: ' + err.message);
        }
    };

    // Branch Handlers
    const handleSubmitNewBranch = async () => {
        if (!newBranchData.name) {
            alert('Branch Name is required');
            return;
        }

        try {
            // 1. Insert into Supabase
            const { data, error } = await supabase
                .from('branches')
                .insert({
                    name: newBranchData.name,
                    address: newBranchData.address,
                    phone: newBranchData.phone,
                    email: newBranchData.email,
                    status: 'Active'
                })
                .select()
                .single();

            if (error) {
                console.error('Supabase Error:', error);
                throw new Error(error.message);
            }

            // 2. Create Local Object using REAL ID
            const newBranch: Branch = {
                id: data.id, // REAL DB ID
                name: data.name,
                email: data.email,
                location: data.address, // Mapping address -> location
                manager: newBranchData.manager || 'Unassigned',
                phone: data.phone,
                ownerName: newBranchData.ownerName,
                ownerEmail: newBranchData.ownerEmail,
                ownerPhone: newBranchData.ownerPhone,
                ownerUsername: newBranchData.ownerUsername,
                ownerPassword: newBranchData.ownerPassword,
                status: 'Active',
                menu: [],
                settings: { ...DEFAULT_BRANCH_SETTINGS },
                staff: []
            };

            // 3. Update UI
            onAddBranch(newBranch);
            setIsAddBranchModalOpen(false);
            setNewBranchData({ name: '', email: '', address: '', manager: '', phone: '', ownerName: '', ownerEmail: '', ownerPhone: '', ownerUsername: '', ownerPassword: '' });
            setUploadStatus('idle');
            alert('Branch created successfully! It is now live on the Landing Page.');

        } catch (err: any) {
            console.error('Failed to create branch:', err);
            alert('Error creating branch: ' + err.message);
        }
    };

    // --- Branch Handlers ---
    const handleDeleteBranch = async (branchId: string) => {
        if (!window.confirm("Are you sure you want to delete this branch? This action cannot be undone and will remove all associated data.")) {
            return;
        }

        try {
            // 1. Delete from Supabase
            const { error } = await supabase
                .from('branches')
                .delete()
                .eq('id', branchId);

            if (error) throw error;

            // 2. Update Local State
            setBranchesList(prev => prev.filter(b => b.id !== branchId));
            if (selectedBranchId === branchId) {
                setSelectedBranchId(null);
                setActiveTab('OVERVIEW');
            }

            // 3. Notify Parent
            if (onDeleteBranch) onDeleteBranch(branchId);

            logAction('DELETE', `Deleted branch ${branchId}`);
            alert('Branch deleted successfully.');

        } catch (err: any) {
            console.error('Error deleting branch:', err);
            alert('Failed to delete branch: ' + err.message);
        }
    };

    const onDeleteBranchWrapper = (id: string) => handleDeleteBranch(id);


    // Customer Handlers
    const handleDeleteCustomer = (customerId: string) => {
        if (window.confirm("Are you sure you want to delete this customer? This will remove their order history.")) {
            setCustomers(prev => prev.filter(c => c.id !== customerId));
            if (selectedCustomer?.id === customerId) setSelectedCustomer(null);
        }
    };

    const openEditCustomer = (customer: BranchCustomer) => {
        setEditCustomerForm(customer);
        setIsEditCustomerModalOpen(true);
    };

    const saveCustomerEdit = () => {
        setCustomers(prev => prev.map(c => c.id === editCustomerForm.id ? { ...c, ...editCustomerForm } as BranchCustomer : c));
        if (selectedCustomer?.id === editCustomerForm.id) {
            setSelectedCustomer(prev => prev ? { ...prev, ...editCustomerForm } : null);
        }
        setIsEditCustomerModalOpen(false);
    };

    const handleUpdateBranchSettings = (updatedSettings: Branch['settings']) => {
        if (!selectedBranch) return;
        const updatedBranch = { ...selectedBranch, settings: updatedSettings };

        // Optimistic Update
        const updatedBranches = branchesList.map(b =>
            b.id === selectedBranch.id ? updatedBranch : b
        );
        setBranchesList(updatedBranches);

        // Propagate to Parent
        if (onUpdateBranch) {
            onUpdateBranch(updatedBranch);
        }

        // Sync & Log
        syncService.broadcastBranchUpdate(updatedBranch);
        logAction('UPDATE', `Updated operational settings for ${updatedBranch.name}`);
    };

    const getBranchStatus = (branch: Branch) => {
        if (branch.settings.emergencyStop?.active) return { status: 'Emergency', label: 'Emergency Stop', color: 'text-red-600 animate-pulse' };
        if (branch.settings.holidayMode.active) return { status: 'Holiday', label: 'Closed (Holiday)', color: 'text-red-500' };

        const now = new Date();
        const dayName = now.toLocaleDateString('en-US', { weekday: 'long' });
        const daySettings = branch.settings.workingDays[dayName];

        if (!daySettings || daySettings.isClosed) return { status: 'Closed', label: 'Closed Today', color: 'text-red-500' };

        const [openH, openM] = daySettings.open.split(':').map(Number);
        const [closeH, closeM] = daySettings.close.split(':').map(Number);

        const openTime = new Date(now); openTime.setHours(openH, openM, 0);
        const closeTime = new Date(now); closeTime.setHours(closeH, closeM, 0);

        if (now < openTime) return { status: 'Opening Soon', label: `Opens at ${daySettings.open}`, color: 'text-orange-500' };
        if (now > closeTime) return { status: 'Closed', label: `Closed at ${daySettings.close}`, color: 'text-red-500' };

        // "Closing Soon" logic (within 30 mins)
        const diffMs = closeTime.getTime() - now.getTime();
        if (diffMs > 0 && diffMs < 30 * 60 * 1000) return { status: 'Closing Soon', label: `Closing at ${daySettings.close}`, color: 'text-orange-500 animate-pulse' };

        return { status: 'Open', label: 'Open Now', color: 'text-emerald-500' };
    };

    // Helper for Currency
    const formatCurrencyWithSAR = (amount: number) => {
        const sar = amount.toFixed(2);
        const pkr = (amount * 74.50).toLocaleString(undefined, { maximumFractionDigits: 0 }); // Approx rate
        return { sar, pkr };
    };

    // --- VIEW: SINGLE BRANCH ---
    if (selectedBranch) {
        // Full Page Kitchen View
        if (selectedKitchenOrder) {
            return (
                <KitchenDetailModal
                    order={selectedKitchenOrder}
                    staff={selectedBranch.staff || []}
                    onClose={() => setSelectedKitchenOrder(null)}
                    onUpdateOrder={handleKitchenUpdate}
                />
            );
        }

        return (
            <div className="space-y-8 animate-fade-in-up pb-10">
                {/* --- CUSTOMER DETAIL PAGE (FULL SCREEN) --- */}
                {selectedCustomer ? (
                    <div className="animate-fade-in-up relative">
                        {/* Navigation Header */}
                        <div className="flex items-center justify-between mb-8">
                            <div className="flex items-center gap-4">
                                <button
                                    onClick={() => setSelectedCustomer(null)}
                                    className="group flex items-center gap-2 px-5 py-3 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 text-slate-500 font-bold text-sm transition-all shadow-sm"
                                >
                                    <ArrowLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
                                    Back to Users
                                </button>
                                <div className="h-10 w-px bg-slate-200"></div>
                                <div className="flex items-center gap-2 text-sm text-slate-500 font-medium">
                                    <Users className="w-4 h-4" />
                                    <span>{selectedBranch.name}</span>
                                    <ChevronRight className="w-4 h-4 text-slate-300" />
                                    <span className="font-bold text-slate-800 text-base font-display">{selectedCustomer.name}</span>
                                </div>
                            </div>
                        </div>

                        {/* Main Content Grid */}
                        <div className="space-y-8">

                            {/* 1. Profile & Stats Banner */}
                            <div className="bg-white rounded-[2.5rem] p-10 shadow-xl shadow-slate-200/50 border border-slate-100 relative overflow-hidden">
                                <div className="absolute top-0 right-0 w-[600px] h-full bg-gradient-to-l from-blue-50/50 via-blue-50/10 to-transparent pointer-events-none"></div>

                                <div className="relative z-10 flex flex-col xl:flex-row gap-10 items-start xl:items-center">

                                    {/* Avatar & Basic Info */}
                                    <div className="flex items-center gap-8 flex-1">
                                        <div className="relative">
                                            <img src={selectedCustomer.avatar} alt={selectedCustomer.name} className="w-28 h-28 rounded-[2rem] border-4 border-white shadow-2xl shadow-slate-200/80" />
                                            <div className="absolute -bottom-3 -right-3 bg-emerald-500 text-white text-[10px] font-extrabold px-3 py-1.5 rounded-full border-[3px] border-white flex items-center gap-1 shadow-sm">
                                                <CheckCircle2 className="w-3.5 h-3.5" /> Active
                                            </div>
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-3 mb-2">
                                                <h2 className="text-4xl font-extrabold text-slate-800 tracking-tight font-display">{selectedCustomer.name}</h2>
                                                <span className="bg-slate-100 text-slate-500 px-3 py-1 rounded-lg text-xs font-mono font-bold border border-slate-200">{selectedCustomer.id}</span>
                                            </div>
                                            <div className="flex flex-wrap gap-4 text-sm font-semibold text-slate-500 mt-3">
                                                <div className="flex items-center gap-2 bg-slate-50 px-4 py-2 rounded-xl border border-slate-100 hover:bg-slate-100 transition-colors">
                                                    <Mail className="w-4 h-4 text-primary" /> {selectedCustomer.email}
                                                </div>
                                                <div className="flex items-center gap-2 bg-slate-50 px-4 py-2 rounded-xl border border-slate-100 hover:bg-slate-100 transition-colors">
                                                    <Phone className="w-4 h-4 text-primary" /> {selectedCustomer.phone}
                                                </div>
                                                <div className="flex items-center gap-2 bg-slate-50 px-4 py-2 rounded-xl border border-slate-100 hover:bg-slate-100 transition-colors">
                                                    <Calendar className="w-4 h-4 text-primary" /> Joined {selectedCustomer.joinDate}
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Quick Stats with Dual Currency */}
                                    <div className="flex gap-4">
                                        <div className="bg-gradient-to-br from-blue-50 to-white px-8 py-6 rounded-[2rem] border border-blue-100 min-w-[180px] shadow-sm">
                                            <p className="text-xs font-bold text-blue-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                                                <Banknote className="w-4 h-4" /> Lifetime Spent
                                            </p>
                                            <p className="text-3xl font-extrabold text-slate-800 font-display">
                                                <span className="text-sm align-top mr-1 font-sans text-slate-400">SAR</span>
                                                {formatCurrencyWithSAR(selectedCustomer.totalSpent).sar}
                                            </p>
                                        </div>
                                        <div className="bg-gradient-to-br from-purple-50 to-white px-8 py-6 rounded-[2rem] border border-purple-100 min-w-[160px] shadow-sm">
                                            <p className="text-xs font-bold text-purple-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                                                <ShoppingBag className="w-4 h-4" /> Total Orders
                                            </p>
                                            <p className="text-3xl font-extrabold text-slate-800 font-display">{selectedCustomer.totalOrders}</p>
                                        </div>
                                    </div>

                                    {/* Actions */}
                                    <div className="flex flex-col gap-3 min-w-[150px]">
                                        <button onClick={() => openEditCustomer(selectedCustomer)} className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-white border border-slate-200 text-slate-700 font-bold rounded-xl hover:bg-slate-50 hover:border-slate-300 transition-all shadow-sm text-xs uppercase tracking-wide">
                                            <Edit className="w-4 h-4" /> Edit Profile
                                        </button>
                                        <button onClick={() => handleDeleteCustomer(selectedCustomer.id)} className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-white border border-red-100 text-red-500 font-bold rounded-xl hover:bg-red-50 hover:border-red-200 transition-all shadow-sm text-xs uppercase tracking-wide">
                                            <Trash2 className="w-4 h-4" /> Delete User
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* 2. Advanced Order History Section */}
                            <div className="bg-white rounded-[2.5rem] shadow-sm border border-slate-100 overflow-hidden flex flex-col min-h-[500px]">
                                {/* Header & Filters */}
                                <div className="p-8 border-b border-slate-100 flex flex-col md:flex-row items-center justify-between gap-6 bg-slate-50/30">
                                    <div className="flex items-center gap-5">
                                        <div className="p-4 bg-white text-indigo-600 rounded-2xl shadow-md shadow-indigo-100 border border-indigo-50">
                                            <Receipt className="w-7 h-7" />
                                        </div>
                                        <div>
                                            <h3 className="text-2xl font-extrabold text-slate-800 font-display">Order History</h3>
                                            <p className="text-slate-500 font-medium mt-0.5">Transaction log & details</p>
                                        </div>
                                    </div>

                                    {/* Filter Bar */}
                                    <div className="flex items-center gap-2 bg-white p-2 rounded-2xl border border-slate-200 shadow-sm">
                                        {(['All', 'Today', 'Yesterday', 'Custom'] as const).map(filter => (
                                            <button
                                                key={filter}
                                                onClick={() => setHistoryFilter(filter)}
                                                className={`px-5 py-2.5 rounded-xl text-xs font-bold transition-all ${historyFilter === filter
                                                    ? 'bg-slate-800 text-white shadow-md'
                                                    : 'text-slate-500 hover:bg-slate-100'
                                                    }`}
                                            >
                                                {filter}
                                            </button>
                                        ))}
                                        {historyFilter === 'Custom' && (
                                            <input
                                                type="date"
                                                value={customHistoryDate}
                                                onChange={(e) => setCustomHistoryDate(e.target.value)}
                                                className="text-xs p-2.5 border border-slate-200 rounded-xl ml-2 outline-none focus:border-primary font-medium text-slate-600"
                                            />
                                        )}
                                    </div>
                                </div>

                                {/* Modern Order List */}
                                <div className="p-8 bg-slate-50/30 flex-1">
                                    <div className="space-y-5">
                                        {filteredOrders.length > 0 ? (
                                            filteredOrders.map((order) => {
                                                const colors = formatCurrencyWithSAR(order.total);
                                                return (
                                                    <div
                                                        key={order.orderId}
                                                        onClick={() => setSelectedOrder(order)}
                                                        className="group cursor-pointer bg-white rounded-3xl border border-slate-200 hover:border-primary/50 hover:shadow-xl hover:shadow-primary/5 hover:-translate-y-1 transition-all duration-300 overflow-hidden relative"
                                                    >
                                                        {/* Order Header Row */}
                                                        <div className="flex flex-col md:flex-row items-start md:items-center p-6 gap-6">
                                                            {/* ID & Date */}
                                                            <div className="flex-1 min-w-[240px]">
                                                                <div className="flex items-center gap-4 mb-1">
                                                                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-bold text-xs border transition-colors shadow-sm ${order.status === 'Completed' ? 'bg-emerald-50 text-emerald-600 border-emerald-100' :
                                                                        order.status === 'Processing' ? 'bg-amber-50 text-amber-600 border-amber-100' : 'bg-red-50 text-red-600 border-red-100'
                                                                        }`}>
                                                                        {order.status === 'Completed' ? <CheckCircle2 className="w-6 h-6" /> : order.status === 'Processing' ? <ChefHat className="w-6 h-6" /> : <XCircle className="w-6 h-6" />}
                                                                    </div>
                                                                    <div>
                                                                        <h4 className="font-extrabold text-slate-800 text-lg group-hover:text-primary transition-colors font-display">Order {order.orderId}</h4>
                                                                        <div className="flex items-center gap-3 text-xs text-slate-400 font-bold mt-1">
                                                                            <span className="flex items-center gap-1"><CalendarDays className="w-3.5 h-3.5" /> {order.date}</span>
                                                                            <span className="text-slate-300">|</span>
                                                                            <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {order.time}</span>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            {/* Status Badge */}
                                                            <div className="flex items-center">
                                                                <span className={`px-4 py-2 rounded-xl text-xs font-bold border flex items-center gap-2 shadow-sm ${order.status === 'Completed' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' :
                                                                    order.status === 'Cancelled' ? 'bg-red-50 text-red-700 border-red-100' : 'bg-amber-50 text-amber-700 border-amber-100'
                                                                    }`}>
                                                                    <span className={`w-2 h-2 rounded-full ${order.status === 'Completed' ? 'bg-emerald-500' :
                                                                        order.status === 'Cancelled' ? 'bg-red-500' : 'bg-amber-500'
                                                                        }`}></span>
                                                                    {order.status}
                                                                </span>
                                                            </div>

                                                            {/* Price Column (Dual Currency) */}
                                                            <div className="text-right min-w-[140px]">
                                                                <p className="text-lg font-black text-slate-800 font-display">SAR {colors.sar}</p>
                                                                <p className="text-[11px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-lg inline-block mt-1">PKR {colors.pkr}</p>
                                                            </div>

                                                            {/* Expand/View Action */}
                                                            <div className="pl-6 border-l border-slate-100">
                                                                <button className="p-3 text-slate-300 group-hover:text-primary bg-slate-50 group-hover:bg-primary/10 rounded-xl transition-all">
                                                                    <ChevronRight className="w-6 h-6" />
                                                                </button>
                                                            </div>
                                                        </div>

                                                        {/* Order Details Preview (Items) */}
                                                        <div className="px-6 pb-6 pt-0">
                                                            <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 flex flex-wrap gap-3 group-hover:bg-blue-50/20 transition-colors">
                                                                {order.items.slice(0, 4).map((item, idx) => (
                                                                    <div key={idx} className="flex items-center gap-2.5 bg-white px-3 py-1.5 rounded-xl border border-slate-200 shadow-sm">
                                                                        <span className="text-[10px] font-black bg-slate-800 text-white px-1.5 py-0.5 rounded-md">{item.qty}x</span>
                                                                        <span className="text-xs font-bold text-slate-600">{item.name}</span>
                                                                    </div>
                                                                ))}
                                                                {order.items.length > 4 && (
                                                                    <div className="flex items-center gap-1 text-xs font-bold text-slate-400 px-3 bg-white rounded-xl border border-slate-200 border-dashed">
                                                                        +{order.items.length - 4} more items
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })
                                        ) : (
                                            <div className="flex flex-col items-center justify-center py-24 bg-white rounded-[2rem] border-2 border-dashed border-slate-200">
                                                <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-6">
                                                    <Filter className="w-8 h-8 text-slate-300" />
                                                </div>
                                                <h3 className="text-xl font-bold text-slate-700">No orders found</h3>
                                                <p className="text-sm text-slate-400">Try changing the date filter.</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* ... Selected Order Portal ... */}
                        {selectedOrder && createPortal(
                            /* ... Same receipt modal content as before ... */
                            <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-slate-900/90 backdrop-blur-sm p-4 animate-fade-in-up">
                                {/* Receipt Wrapper */}
                                <div className="relative w-full max-w-[400px] flex flex-col max-h-[85vh]">

                                    <div className="relative flex-1 flex flex-col min-h-0 filter drop-shadow-2xl">
                                        <div className="bg-white flex-1 overflow-y-auto rounded-t-xl no-scrollbar relative z-10 p-8">
                                            <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-10 pointer-events-none mix-blend-multiply"></div>
                                            <div className="relative z-10">
                                                <div className="text-center mb-8">
                                                    <div className="inline-flex items-center justify-center w-16 h-16 bg-slate-900 text-white rounded-2xl mb-4 shadow-lg rotate-3">
                                                        <UtensilsCrossed className="w-8 h-8" />
                                                    </div>
                                                    <h2 className="text-3xl font-black uppercase tracking-tight text-slate-900 font-display">FOOD BOOT</h2>
                                                    <div className="mt-3 space-y-1 text-xs text-slate-500 font-bold font-mono tracking-tight uppercase">
                                                        <p>{selectedBranch?.name}</p>
                                                        <p>{selectedBranch?.location}</p>
                                                        <p>{selectedBranch?.phone}</p>
                                                    </div>
                                                </div>
                                                <div className="border-b-2 border-dashed border-slate-300 my-6 relative">
                                                    <div className="absolute -left-10 -top-1 w-2 h-2 rounded-full bg-slate-200"></div>
                                                    <div className="absolute -right-10 -top-1 w-2 h-2 rounded-full bg-slate-200"></div>
                                                </div>
                                                <div className="grid grid-cols-2 gap-y-3 mb-6 text-xs font-mono">
                                                    <div className="text-slate-500 font-bold uppercase tracking-wider">Order ID</div>
                                                    <div className="text-right font-black text-slate-900 text-sm">#{selectedOrder.orderId.split('-').pop()}</div>
                                                    <div className="text-slate-500 font-bold uppercase tracking-wider">Date</div>
                                                    <div className="text-right font-bold">{selectedOrder.date}</div>
                                                    <div className="text-slate-500 font-bold uppercase tracking-wider">Time</div>
                                                    <div className="text-right font-bold">{selectedOrder.time}</div>
                                                    <div className="text-slate-500 font-bold uppercase tracking-wider">Status</div>
                                                    <div className="text-right uppercase font-black text-slate-900">{selectedOrder.status}</div>
                                                    <div className="text-slate-500 font-bold uppercase tracking-wider">Payment</div>
                                                    <div className="text-right uppercase font-bold">{selectedOrder.paymentMethod}</div>
                                                </div>
                                                <div className="mb-6 bg-slate-50 p-4 rounded-xl border border-slate-200/60">
                                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Customer</p>
                                                    <p className="font-bold text-slate-900 text-sm font-display">{selectedCustomer.name}</p>
                                                    <p className="text-xs text-slate-500 font-mono mt-0.5">{selectedCustomer.phone}</p>
                                                </div>
                                                <div className="flex justify-between text-[10px] font-black uppercase text-slate-400 mb-4 tracking-widest border-b border-slate-100 pb-2">
                                                    <span className="w-8 text-center">Qty</span>
                                                    <span className="flex-1 px-3">Item</span>
                                                    <span className="text-right w-16">AMT</span>
                                                </div>
                                                <div className="space-y-4 mb-8">
                                                    {selectedOrder.items.map((item, idx) => (
                                                        <div key={idx} className="flex justify-between items-start text-xs font-mono">
                                                            <span className="w-8 text-center font-bold text-slate-900 pt-0.5">{item.qty}</span>
                                                            <div className="flex-1 px-3">
                                                                <p className="font-bold text-slate-900 leading-tight uppercase">{item.name}</p>
                                                                <p className="text-[10px] text-slate-400 mt-1 font-sans">@{item.price.toFixed(2)} SAR</p>
                                                            </div>
                                                            <span className="text-right w-16 font-bold text-slate-900 pt-0.5">{(item.qty * item.price).toFixed(2)}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                                <div className="border-b-2 border-slate-900 my-6"></div>
                                                <div className="space-y-3 text-xs font-mono">
                                                    <div className="flex justify-between text-slate-500 font-bold">
                                                        <span>SUBTOTAL (Excl. VAT)</span>
                                                        <span>SAR {(selectedOrder.total / 1.15).toFixed(2)}</span>
                                                    </div>
                                                    <div className="flex justify-between text-slate-500 font-bold">
                                                        <span>VAT (15%)</span>
                                                        <span>SAR {(selectedOrder.total - (selectedOrder.total / 1.15)).toFixed(2)}</span>
                                                    </div>
                                                    <div className="border-b border-dashed border-slate-300 my-4"></div>
                                                    <div className="flex justify-between items-end bg-slate-900 text-white p-5 rounded-xl shadow-xl shadow-slate-200 mt-2 relative overflow-hidden">
                                                        <div className="absolute inset-0 bg-white/5 opacity-50 bg-[url('https://grainy-gradients.vercel.app/noise.svg')]"></div>
                                                        <div className="relative z-10 flex flex-col">
                                                            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Total Due</span>
                                                            <span className="text-3xl font-black tracking-tight font-display">SAR {selectedOrder.total.toFixed(2)}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="receipt-zigzag relative z-20"></div>
                                    </div>
                                    <div className="mt-8 flex gap-3 shrink-0 animate-fade-in-up" style={{ animationDelay: '100ms' }}>
                                        <button onClick={() => setSelectedOrder(null)} className="flex-1 py-4 rounded-xl bg-slate-800 text-white font-bold shadow-xl hover:bg-slate-700 hover:shadow-2xl transition-all text-sm uppercase tracking-widest flex items-center justify-center gap-2"><X className="w-4 h-4" /> Close</button>
                                        <button className="flex-1 py-4 rounded-xl bg-primary text-white font-bold shadow-xl shadow-primary/30 hover:bg-sky-500 hover:shadow-sky-500/40 transition-all text-sm uppercase tracking-widest flex items-center justify-center gap-2"><Printer className="w-4 h-4" /> Print</button>
                                    </div>
                                </div>
                            </div>,
                            document.body
                        )}
                    </div>
                ) : (
                    <>
                        {/* Navigation & Title */}
                        <div className="flex items-center gap-4 mb-4">
                            <button
                                onClick={() => { setSelectedBranchId(null); setSelectedCustomer(null); setActiveTab('OVERVIEW'); }}
                                className="p-3 hover:bg-slate-200 rounded-full transition-colors text-slate-500"
                            >
                                <ArrowLeft className="w-6 h-6" />
                            </button>
                            <div>
                                <h2 className="text-3xl font-extrabold text-slate-800 flex items-center gap-3 font-display tracking-tight">
                                    {selectedBranch.name}
                                    <span className={`px-4 py-1.5 text-xs rounded-full font-black uppercase tracking-[0.2em] border shadow-sm ${getBranchStatus(selectedBranch).status === 'Open' ? 'bg-emerald-50 text-emerald-600 border-emerald-200' :
                                        getBranchStatus(selectedBranch).status.includes('Soon') ? 'bg-orange-50 text-orange-600 border-orange-200 animate-pulse' :
                                            'bg-red-50 text-red-600 border-red-200'
                                        }`}>
                                        {getBranchStatus(selectedBranch).label}
                                    </span>
                                </h2>
                                <p className="text-slate-500 font-medium mt-1">Branch Management Portal • {selectedBranch.location}</p>
                            </div>
                        </div>

                        {/* Branch Info Cards */}
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                            <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100 flex items-start gap-4 hover:shadow-md transition-all">
                                <div className="p-3.5 bg-blue-50 text-primary rounded-2xl"><MapPin className="w-6 h-6" /></div>
                                <div><p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Address</p><p className="text-slate-800 font-bold mt-1 text-sm">{selectedBranch.location}</p></div>
                            </div>
                            <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100 flex items-start gap-4 hover:shadow-md transition-all">
                                <div className="p-3.5 bg-purple-50 text-purple-600 rounded-2xl"><User className="w-6 h-6" /></div>
                                <div><p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Manager</p><p className="text-slate-800 font-bold mt-1 text-sm">{selectedBranch.manager}</p></div>
                            </div>
                            <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100 flex items-start gap-4 hover:shadow-md transition-all">
                                <div className="p-3.5 bg-orange-50 text-orange-600 rounded-2xl"><Briefcase className="w-6 h-6" /></div>
                                <div><p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Owner</p><p className="text-slate-800 font-bold mt-1 text-sm">{selectedBranch.ownerName}</p></div>
                            </div>
                            <div className="bg-white p-6 rounded-[2rem] shadow-sm border border-slate-100 flex items-start gap-4 hover:shadow-md transition-all">
                                <div className="p-3.5 bg-emerald-50 text-emerald-600 rounded-2xl"><Phone className="w-6 h-6" /></div>
                                <div><p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Contact</p><p className="text-slate-800 font-bold mt-1 text-sm">{selectedBranch.phone}</p></div>
                            </div>
                        </div>

                        {/* Quick Actions Bar */}
                        <div className="bg-slate-900 rounded-[2rem] p-6 mb-8 shadow-xl shadow-slate-900/10 border border-slate-800 flex flex-col xl:flex-row items-center justify-between gap-6 relative overflow-hidden group">
                            {/* Background decoration */}
                            <div className="absolute top-0 right-0 w-64 h-64 bg-slate-800/50 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none group-hover:bg-primary/20 transition-colors duration-500"></div>

                            <div className="relative z-10 flex items-center gap-4 w-full md:w-auto">
                                <div className="p-3 bg-slate-800 rounded-xl border border-slate-700">
                                    <Zap className="w-6 h-6 text-yellow-500" />
                                </div>
                                <div>
                                    <h4 className="text-white font-extrabold text-lg flex items-center gap-2 font-display">
                                        Quick Actions
                                    </h4>
                                    <p className="text-slate-400 text-xs font-medium mt-1">Immediate operational controls</p>
                                </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-3 relative z-10 w-full xl:w-auto justify-end">
                                {/* Online Orders Toggle */}
                                <button
                                    onClick={() => handleUpdateBranchSettings({
                                        ...selectedBranch.settings,
                                        isOnlinePaused: !selectedBranch.settings.isOnlinePaused
                                    })}
                                    className={`flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border ${selectedBranch.settings.isOnlinePaused
                                        ? 'bg-orange-500 text-white border-orange-500 shadow-lg shadow-orange-500/20'
                                        : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                                        }`}
                                >
                                    <div className={`w-2 h-2 rounded-full ${selectedBranch.settings.isOnlinePaused ? 'bg-white animate-pulse' : 'bg-slate-500'}`}></div>
                                    Pause Online Orders
                                </button>

                                {/* Voice Orders Toggle */}
                                <button
                                    onClick={() => handleUpdateBranchSettings({
                                        ...selectedBranch.settings,
                                        isVoicePaused: !selectedBranch.settings.isVoicePaused
                                    })}
                                    className={`flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border ${selectedBranch.settings.isVoicePaused
                                        ? 'bg-purple-500 text-white border-purple-500 shadow-lg shadow-purple-500/20'
                                        : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                                        }`}
                                >
                                    <div className={`w-2 h-2 rounded-full ${selectedBranch.settings.isVoicePaused ? 'bg-white animate-pulse' : 'bg-slate-500'}`}></div>
                                    Pause Voice AI
                                </button>

                                {/* Kitchen Busy Mode */}
                                <button
                                    onClick={() => handleUpdateBranchSettings({
                                        ...selectedBranch.settings,
                                        kitchenBusyMode: !selectedBranch.settings.kitchenBusyMode
                                    })}
                                    className={`flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border ${selectedBranch.settings.kitchenBusyMode
                                        ? 'bg-yellow-500 text-white border-yellow-500 shadow-lg shadow-yellow-500/20'
                                        : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                                        }`}
                                >
                                    <div className={`w-2 h-2 rounded-full ${selectedBranch.settings.kitchenBusyMode ? 'bg-white animate-pulse' : 'bg-slate-500'}`}></div>
                                    Kitchen Busy
                                </button>

                                {/* Emergency Stop */}
                                <button
                                    onClick={() => handleUpdateBranchSettings({
                                        ...selectedBranch.settings,
                                        emergencyStop: {
                                            active: !selectedBranch.settings.emergencyStop?.active, // Safe access in case init is slow
                                            until: !selectedBranch.settings.emergencyStop?.active ? new Date(Date.now() + 3600000).toISOString() : null
                                        }
                                    })}
                                    className={`flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border ${selectedBranch.settings.emergencyStop?.active
                                        ? 'bg-red-500 text-white border-red-500 shadow-lg shadow-red-500/20 animate-pulse'
                                        : 'bg-slate-800 text-red-500 border-red-900/30 hover:bg-red-950/30'
                                        }`}
                                >
                                    <AlertTriangle className="w-4 h-4" />
                                    {selectedBranch.settings.emergencyStop?.active ? 'EMERGENCY STOP ACTIVE' : 'Emergency Stop'}
                                </button>
                            </div>
                        </div>

                        {/* TABS Navigation & Filters */}
                        <div className={`flex flex-col md:flex-row justify-between items-start md:items-center gap-6 border-b border-slate-200 mb-8 ${hideTabs ? 'hidden' : ''}`}>
                            {!hideTabs && (
                                <div className="flex gap-8">
                                    <button
                                        onClick={() => setActiveTab('OVERVIEW')}
                                        className={`pb-4 px-2 text-sm font-extrabold transition-all relative uppercase tracking-wide ${activeTab === 'OVERVIEW' ? 'text-primary' : 'text-slate-400 hover:text-slate-600'
                                            }`}
                                    >
                                        Overview
                                        {activeTab === 'OVERVIEW' && <div className="absolute bottom-0 left-0 w-full h-1 bg-primary rounded-t-full"></div>}
                                    </button>
                                    <button
                                        onClick={() => setActiveTab('MENU')}
                                        className={`pb-4 px-2 text-sm font-extrabold transition-all relative uppercase tracking-wide ${activeTab === 'MENU' ? 'text-primary' : 'text-slate-400 hover:text-slate-600'
                                            }`}
                                    >
                                        Menu Management
                                        {activeTab === 'MENU' && <div className="absolute bottom-0 left-0 w-full h-1 bg-primary rounded-t-full"></div>}
                                    </button>
                                    <button
                                        onClick={() => setActiveTab('CUSTOMERS')}
                                        className={`pb-4 px-2 text-sm font-extrabold transition-all relative uppercase tracking-wide ${activeTab === 'CUSTOMERS' ? 'text-primary' : 'text-slate-400 hover:text-slate-600'
                                            }`}
                                    >
                                        Customer Database
                                        {activeTab === 'CUSTOMERS' && <div className="absolute bottom-0 left-0 w-full h-1 bg-primary rounded-t-full"></div>}
                                    </button>
                                    <button
                                        onClick={() => setActiveTab('SETTINGS')}
                                        className={`pb-4 px-2 text-sm font-extrabold transition-all relative uppercase tracking-wide ${activeTab === 'SETTINGS' ? 'text-primary' : 'text-slate-400 hover:text-slate-600'
                                            }`}
                                    >
                                        Settings
                                        {activeTab === 'SETTINGS' && <div className="absolute bottom-0 left-0 w-full h-1 bg-primary rounded-t-full"></div>}
                                    </button>
                                    <button
                                        onClick={() => setActiveTab('STAFF')}
                                        className={`pb-4 px-2 text-sm font-extrabold transition-all relative uppercase tracking-wide ${activeTab === 'STAFF' ? 'text-primary' : 'text-slate-400 hover:text-slate-600'
                                            }`}
                                    >
                                        Staff Management
                                        {activeTab === 'STAFF' && <div className="absolute bottom-0 left-0 w-full h-1 bg-primary rounded-t-full"></div>}
                                    </button>
                                </div>
                            )}

                            {activeTab === 'OVERVIEW' && (
                                <div className="flex items-center gap-2 mb-4 md:mb-0 bg-slate-50 p-1.5 rounded-2xl border border-slate-100">
                                    <span className="text-[10px] font-black text-slate-400 uppercase px-2">Data Period:</span>
                                    {(['Today', 'Yesterday', 'Last Week', 'Month', 'All Time'] as TimeRange[]).map((range) => (
                                        <button
                                            key={range}
                                            onClick={() => setTimeRange(range)}
                                            className={`px-3 py-1.5 rounded-xl text-[10px] font-black transition-all whitespace-nowrap border uppercase tracking-wider ${timeRange === range
                                                ? 'bg-slate-800 text-white border-slate-800 shadow-sm'
                                                : 'bg-white text-slate-500 border-slate-100 hover:border-slate-300'
                                                }`}
                                        >
                                            {range}
                                        </button>
                                    ))}
                                    <div className="relative z-[70]">
                                        <button
                                            onClick={() => {
                                                if (timeRange === 'Custom') {
                                                    setIsCustomPickerOpen(!isCustomPickerOpen);
                                                } else {
                                                    setTimeRange('Custom');
                                                    setIsCustomPickerOpen(true);
                                                }
                                            }}
                                            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-[10px] font-black transition-all border uppercase tracking-wider ${timeRange === 'Custom' ? 'bg-primary text-white border-primary shadow-md' : 'bg-white text-slate-500 border-slate-100 hover:border-slate-300'
                                                }`}
                                        >
                                            <Calendar className="w-3 h-3" />
                                            <span>{timeRange === 'Custom' && customDate.start ? `${customDate.start.slice(5)} to ${customDate.end.slice(5)}` : 'Custom Range'}</span>
                                        </button>

                                        {isCustomPickerOpen && (
                                            <div className="absolute top-full right-0 mt-4 z-[200] w-80 animate-pop">
                                                <div
                                                    className="bg-white p-6 rounded-[2.5rem] shadow-2xl border border-slate-100 ring-1 ring-black/5"
                                                    onClick={(e) => e.stopPropagation()}
                                                >
                                                    <div className="space-y-5">
                                                        <div className="flex items-center justify-between">
                                                            <div>
                                                                <h4 className="text-sm font-black text-slate-800 uppercase tracking-wider">Custom Range</h4>
                                                                <p className="text-[10px] text-slate-400 font-bold mt-1">Select dates for analytics</p>
                                                            </div>
                                                            <button onClick={() => { setTimeRange('Today'); setIsCustomPickerOpen(false); }} className="p-2 text-slate-300 hover:text-red-500 transition-colors">
                                                                <RefreshCcw className="w-4 h-4" />
                                                            </button>
                                                        </div>

                                                        <div className="grid grid-cols-1 gap-4">
                                                            <div className="space-y-1.5">
                                                                <label className="text-[10px] text-slate-400 font-black uppercase tracking-widest ml-1">Start Date</label>
                                                                <input
                                                                    type="date"
                                                                    className="w-full text-sm font-bold p-3.5 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all cursor-pointer"
                                                                    value={customDate.start}
                                                                    onChange={(e) => setCustomDate({ ...customDate, start: e.target.value })}
                                                                />
                                                            </div>
                                                            <div className="space-y-1.5">
                                                                <label className="text-[10px] text-slate-400 font-black uppercase tracking-widest ml-1">End Date</label>
                                                                <input
                                                                    type="date"
                                                                    className="w-full text-sm font-bold p-3.5 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all cursor-pointer"
                                                                    value={customDate.end}
                                                                    onChange={(e) => setCustomDate({ ...customDate, end: e.target.value })}
                                                                />
                                                            </div>
                                                        </div>

                                                        <button
                                                            onClick={() => {
                                                                setIsCustomPickerOpen(false);
                                                                refreshDetails();
                                                            }}
                                                            className="w-full py-4 bg-primary text-white rounded-2xl text-[11px] font-black uppercase tracking-widest hover:bg-primary/90 hover:scale-[1.02] active:scale-[0.98] transition-all shadow-lg shadow-primary/25"
                                                        >
                                                            Analyze Range
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                    <button
                                        onClick={() => {
                                            const branch = branches.find(b => b.id === selectedBranchId);
                                            const fileName = `Full_Overview_${branch ? branch.name : 'Global'}_${new Date().toISOString().split('T')[0]}`;

                                            // Prepare activity data (Live Orders + Real Audit Logs)
                                            const activityData = [
                                                ...(fetchedLiveOrders || []).map(order => ({
                                                    action: 'Live Order',
                                                    detail: `${order.customerName} placed an order for SAR ${order.total}`,
                                                    time: order.timestamp,
                                                    user: 'Customer'
                                                })),
                                                ...(fetchedLogs || []).map(log => ({
                                                    action: log.action || 'System Log',
                                                    detail: log.details || 'Operational update',
                                                    time: new Date(log.created_at || log.timestamp).toLocaleTimeString(),
                                                    user: log.user_name || 'System'
                                                }))
                                            ];

                                            ReportsService.generateCompleteOverviewExport({
                                                summary: fetchedStats,
                                                timeline: overviewData?.hourlyData || [],
                                                topItems: overviewData?.topItems || [],
                                                sources: overviewData?.orderSource || [],
                                                activity: activityData,
                                                lowStock: lowStockItems,
                                                transactions: fetchedAllOrders,
                                                customers: fetchedCustomers,
                                                staff: branch?.staff || [],
                                                menu: branch?.menu || []
                                            }, fileName);
                                        }}
                                        className="flex items-center gap-2 px-4 py-1.5 bg-emerald-500 text-white rounded-xl text-[10px] font-black uppercase tracking-wider hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-500/20"
                                    >
                                        <Download className="w-3.5 h-3.5" />
                                        Export Excel
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* TAB CONTENT: OVERVIEW */}
                        {activeTab === 'OVERVIEW' && !overviewData && (
                            <div className="flex flex-col items-center justify-center min-h-[400px] text-slate-400">
                                <Loader2 className="w-12 h-12 animate-spin mb-4 opacity-20" />
                                <p className="font-bold text-sm">Loading branch intelligence...</p>
                            </div>
                        )}

                        {activeTab === 'OVERVIEW' && overviewData && (
                            <div className="space-y-8 animate-fade-in-up">

                                {/* 1.1 Critical Inventory Alerts */}
                                {lowStockItems.length > 0 && (
                                    <div className="bg-red-50 rounded-[2.5rem] p-8 border border-red-100 shadow-sm animate-fade-in-up relative overflow-hidden mb-8">
                                        <div className="flex flex-col md:flex-row items-center justify-between gap-6 relative z-10">
                                            <div className="flex items-center gap-5">
                                                <div className="p-4 bg-red-100/50 rounded-2xl">
                                                    <AlertTriangle className="w-8 h-8 text-red-500 animate-pulse" />
                                                </div>
                                                <div>
                                                    <h3 className="text-xl font-extrabold text-red-900 font-display">Critical Low Stock Warning</h3>
                                                    <p className="text-red-700 font-medium mt-1">
                                                        {lowStockItems.length} items are below the minimum threshold. Immediate restock recommended.
                                                    </p>
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => setActiveTab('MENU')}
                                                className="px-8 py-4 bg-red-500 text-white rounded-2xl font-bold shadow-lg shadow-red-500/20 hover:bg-red-600 transition-all text-sm uppercase tracking-wide"
                                            >
                                                Manage Inventory
                                            </button>
                                        </div>

                                        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                            {lowStockItems.map(item => (
                                                <div key={item.key} className="bg-white p-4 rounded-2xl border border-red-100 shadow-sm flex items-center justify-between group hover:border-red-300 transition-all">
                                                    <div className="flex items-center gap-3">
                                                        <div className="relative">
                                                            <div className="w-10 h-10 bg-red-50 rounded-xl flex items-center justify-center text-red-500 font-bold text-xs ring-4 ring-white shadow-sm">
                                                                {item.category === 'Burgers' ? '🍔' : item.category === 'Drinks' ? '🥤' : '📦'}
                                                            </div>
                                                            <div className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border-2 border-white animate-pulse"></div>
                                                        </div>
                                                        <div>
                                                            <h4 className="text-sm font-bold text-slate-800 line-clamp-1">{item.name_en}</h4>
                                                            <div className="flex items-center gap-1 mt-0.5">
                                                                <span className="text-[10px] font-black text-red-500 bg-red-50 px-1.5 rounded-md">
                                                                    {item.stock} left
                                                                </span>
                                                                <span className="text-[9px] text-slate-400 font-bold uppercase">/ Min {item.minStockThreshold}</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="flex flex-col items-end gap-2">
                                                        {item.stock === 0 && (
                                                            <div className="bg-red-100 px-2 py-1 rounded-md">
                                                                <span className="text-[9px] font-black text-red-600 uppercase">OOS</span>
                                                            </div>
                                                        )}
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                if (onRequestRestock) onRequestRestock(item);
                                                                else alert(`Restock requested for ${item.name_en}`);
                                                            }}
                                                            className="px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg text-[10px] font-bold uppercase tracking-wide transition-colors"
                                                        >
                                                            Request
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* 1. AI Prediction Banner */}
                                <div className="bg-gradient-to-r from-violet-600 to-indigo-600 rounded-3xl p-1 shadow-lg shadow-indigo-500/20">
                                    <div className="bg-white/10 backdrop-blur-sm rounded-[22px] p-6 flex flex-col md:flex-row items-center justify-between gap-6 text-white relative overflow-hidden">
                                        <div className="absolute -right-10 -top-10 text-white/5 rotate-12">
                                            <Bot className="w-48 h-48" />
                                        </div>
                                        <div className="flex items-start gap-4 relative z-10">
                                            <div className="p-3 bg-white/20 rounded-2xl">
                                                <Zap className="w-6 h-6 text-yellow-300 fill-yellow-300" />
                                            </div>
                                            <div>
                                                <h3 className="text-xl font-bold mb-1">Branch Insight: Stock Alert</h3>
                                                <p className="text-indigo-100 text-sm max-w-xl leading-relaxed">
                                                    AI predicts a <strong>40% surge</strong> in Zinger Burger orders this weekend based on local events. Ensure inventory levels are sufficient.
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* 2. Live Kitchen Monitor (New) */}
                                <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-100 overflow-hidden relative">
                                    <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-bl-full pointer-events-none"></div>

                                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-8 relative z-10">
                                        <div>
                                            <h3 className="text-2xl font-extrabold text-slate-800 font-display flex items-center gap-3">
                                                Live Kitchen Monitor
                                                <span className="flex h-3 w-3 rounded-full bg-emerald-500 animate-pulse"></span>
                                            </h3>
                                            <p className="text-slate-500 font-medium">Real-time order tracking and workflow management</p>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <div className="bg-slate-50 px-4 py-2 rounded-xl border border-slate-100 flex items-center gap-3">
                                                <div className="flex -space-x-2">
                                                    {liveOrders.slice(0, 3).map((o, i) => (
                                                        <img key={i} src={o.customerAvatar} className="w-8 h-8 rounded-full border-2 border-white" alt="user" />
                                                    ))}
                                                </div>
                                                <span className="text-sm font-bold text-slate-600">{liveOrders.length} Active Orders</span>
                                            </div>
                                        </div>
                                    </div>

                                    {liveOrders.length > 0 ? (
                                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 relative z-10">
                                            {liveOrders.map((order) => (
                                                <div
                                                    key={order.id}
                                                    onClick={() => {
                                                        console.log('Clicked Order:', order.id);
                                                        setSelectedKitchenOrder(order);
                                                    }}
                                                    className="bg-slate-50 border border-slate-200 rounded-3xl p-6 hover:shadow-xl hover:shadow-blue-500/5 transition-all group relative overflow-hidden cursor-pointer active:scale-[0.98]"
                                                >
                                                    {/* Progress Line */}
                                                    <div className={`absolute top-0 left-0 h-1 transition-all duration-500 ${order.status === LiveOrderStatus.PENDING ? 'w-1/4 bg-orange-400' :
                                                        order.status === LiveOrderStatus.PREPARING ? 'w-2/4 bg-blue-500' :
                                                            order.status === LiveOrderStatus.READY ? 'w-3/4 bg-indigo-500' : 'w-full bg-emerald-500'
                                                        }`}></div>

                                                    <div className="flex justify-between items-start mb-4">
                                                        <div className="flex items-center gap-3">
                                                            <img src={order.customerAvatar} className="w-12 h-12 rounded-2xl shadow-sm" alt={order.customerName} />
                                                            <div>
                                                                <h4 className="text-sm font-extrabold text-slate-800">{order.customerName}</h4>
                                                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1">
                                                                    <Clock className="w-3 h-3" /> {order.elapsedMinutes}m ago • #{order.id.split('-').pop()}
                                                                </p>
                                                            </div>
                                                        </div>
                                                        <span className={`px-3 py-1 text-[10px] font-black uppercase tracking-widest rounded-lg border ${order.status === LiveOrderStatus.PENDING ? 'bg-orange-50 text-orange-600 border-orange-100' :
                                                            order.status === LiveOrderStatus.PREPARING ? 'bg-blue-50 text-blue-600 border-blue-100' :
                                                                order.status === LiveOrderStatus.READY ? 'bg-indigo-50 text-indigo-600 border-indigo-100' :
                                                                    'bg-emerald-50 text-emerald-600 border-emerald-100'
                                                            }`}>
                                                            {order.status}
                                                        </span>
                                                    </div>

                                                    <div className="space-y-2 mb-6 min-h-[60px]">
                                                        {order.items.map((item, i) => (
                                                            <div key={i} className="flex justify-between text-xs font-bold text-slate-600">
                                                                <span>{item.qty}x {item.name}</span>
                                                                <span className="text-slate-400">#K-{22 + i}</span>
                                                            </div>
                                                        ))}
                                                    </div>

                                                    <div className="flex items-center gap-2">
                                                        {order.status === LiveOrderStatus.PENDING && (
                                                            <button
                                                                onClick={() => updateOrderStatus(order.id, LiveOrderStatus.PREPARING)}
                                                                className="flex-1 bg-white border border-slate-200 text-slate-700 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-blue-500 hover:text-white hover:border-blue-500 transition-all shadow-sm"
                                                            >
                                                                Start Prep
                                                            </button>
                                                        )}
                                                        {order.status === LiveOrderStatus.PREPARING && (
                                                            <button
                                                                onClick={() => updateOrderStatus(order.id, LiveOrderStatus.READY)}
                                                                className="flex-1 bg-blue-500 text-white py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-blue-600 transition-all shadow-lg shadow-blue-500/20"
                                                            >
                                                                Finish Cooking
                                                            </button>
                                                        )}
                                                        {order.status === LiveOrderStatus.READY && (
                                                            <button
                                                                onClick={() => updateOrderStatus(order.id, LiveOrderStatus.COMPLETED)}
                                                                className="flex-1 bg-indigo-600 text-white py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-emerald-500 transition-all shadow-lg shadow-indigo-500/20 uppercase"
                                                            >
                                                                Handover
                                                            </button>
                                                        )}
                                                        <button className="p-2.5 bg-white border border-slate-200 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-50 transition-colors">
                                                            <Printer className="w-4 h-4" />
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="flex flex-col items-center justify-center py-16 bg-slate-50/50 rounded-[2rem] border-2 border-dashed border-slate-200">
                                            <ChefHat className="w-12 h-12 text-slate-200 mb-4" />
                                            <p className="text-slate-500 font-bold">No active orders in kitchen</p>
                                            <p className="text-xs text-slate-400">Incoming orders will appear here automatically</p>
                                        </div>
                                    )}
                                </div>

                                {/* 3. KPI Cards */}
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                                    {[
                                        { label: 'Total Revenue', value: `SAR ${fetchedStats?.totalRevenue.toLocaleString() || '0'}`, icon: Banknote, color: 'blue', trend: fetchedStats?.revenueTrend || '+0%', isUp: true },
                                        { label: 'Total Orders', value: fetchedStats?.totalOrders.toString() || '0', icon: ShoppingBag, color: 'purple', trend: fetchedStats?.ordersTrend || '+0%', isUp: true },
                                        { label: 'Avg Order Value', value: `SAR ${fetchedStats?.avgOrderValue.toFixed(2) || '0.00'}`, icon: Percent, color: 'cyan', trend: '-2%', isUp: false },
                                        { label: 'Customer Satisfaction', value: `${fetchedStats?.satisfaction || '4.8'}/5`, icon: Star, color: 'yellow', trend: '+0.1', isUp: true }
                                    ].map((stat, i) => (
                                        <div key={i} className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm hover:shadow-md transition-all group">
                                            <div className="flex justify-between items-start mb-4">
                                                <div className={`p-3 rounded-2xl bg-${stat.color}-50 text-${stat.color}-500 group-hover:scale-110 transition-transform`}>
                                                    <stat.icon className={`w-6 h-6 ${stat.color === 'yellow' ? 'fill-yellow-400 text-yellow-400' : ''}`} />
                                                </div>
                                                <span className={`text-xs font-bold flex items-center gap-1 ${stat.isUp ? 'text-emerald-500' : 'text-red-500'}`}>
                                                    {stat.isUp ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                                                    {stat.trend}
                                                </span>
                                            </div>
                                            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">{stat.label}</p>
                                            <h3 className="text-2xl font-extrabold text-slate-800 font-display">{stat.value}</h3>
                                        </div>
                                    ))}
                                </div>

                                {/* 3. Main Charts Section */}
                                <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

                                    {/* Revenue & Orders Timeline */}
                                    <div className="xl:col-span-2 bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-100">
                                        <div className="flex justify-between items-center mb-8">
                                            <div>
                                                <h3 className="text-xl font-extrabold text-slate-800 font-display">Performance Timeline</h3>
                                                <p className="text-slate-500 text-sm font-medium">Revenue vs Order Volume (Hourly)</p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className="flex items-center gap-2 text-xs font-bold text-slate-600 px-3 py-1 bg-slate-50 rounded-lg">
                                                    <span className="w-2 h-2 rounded-full bg-blue-500"></span> Revenue
                                                </span>
                                                <span className="flex items-center gap-2 text-xs font-bold text-slate-600 px-3 py-1 bg-slate-50 rounded-lg">
                                                    <span className="w-2 h-2 rounded-full bg-purple-500"></span> Orders
                                                </span>
                                            </div>
                                        </div>
                                        <div className="h-[300px] w-full">
                                            <ResponsiveContainer width="100%" height="100%">
                                                <AreaChart data={overviewData.hourlyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                                    <defs>
                                                        <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                                                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.1} />
                                                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                                                        </linearGradient>
                                                        <linearGradient id="colorOrd" x1="0" y1="0" x2="0" y2="1">
                                                            <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.1} />
                                                            <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                                                        </linearGradient>
                                                    </defs>
                                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                                    <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11, fontWeight: 600 }} dy={10} />
                                                    <YAxis yAxisId="left" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} />
                                                    <YAxis yAxisId="right" orientation="right" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 11 }} />
                                                    <RechartsTooltip
                                                        contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)' }}
                                                        itemStyle={{ fontSize: '12px', fontWeight: 'bold' }}
                                                        cursor={{ stroke: '#cbd5e1', strokeWidth: 1, strokeDasharray: '4 4' }}
                                                    />
                                                    <Area yAxisId="left" type="monotone" dataKey="revenue" stroke="#3b82f6" strokeWidth={3} fill="url(#colorRev)" name="Revenue (SAR)" />
                                                    <Area yAxisId="right" type="monotone" dataKey="orders" stroke="#8b5cf6" strokeWidth={3} fill="url(#colorOrd)" name="Orders" />
                                                </AreaChart>
                                            </ResponsiveContainer>
                                        </div>
                                    </div>

                                    {/* Top Items & Sources */}
                                    <div className="space-y-6">
                                        {/* Top Items */}
                                        <div className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-100 flex-1">
                                            <h3 className="text-lg font-extrabold text-slate-800 font-display mb-4">Top Selling Items</h3>
                                            <div className="space-y-4">
                                                {overviewData.topItems.slice(0, 4).map((item, idx) => (
                                                    <div key={idx} className="flex items-center gap-3">
                                                        <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center font-bold text-slate-500 text-xs border border-slate-100">
                                                            #{idx + 1}
                                                        </div>
                                                        <div className="flex-1">
                                                            <div className="flex justify-between mb-1">
                                                                <span className="text-sm font-bold text-slate-700">{item.name}</span>
                                                                <span className="text-xs font-bold text-slate-400">{item.count} sold</span>
                                                            </div>
                                                            <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                                                                <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${(item.count / 250) * 100}%` }}></div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Order Source */}
                                        <div className="bg-white p-6 rounded-[2.5rem] shadow-sm border border-slate-100 flex-1 flex flex-col justify-center">
                                            <h3 className="text-lg font-extrabold text-slate-800 font-display mb-2">Order Sources</h3>
                                            <div className="h-[180px] w-full relative">
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <PieChart>
                                                        <Pie
                                                            data={overviewData.orderSource}
                                                            innerRadius={50}
                                                            outerRadius={70}
                                                            paddingAngle={5}
                                                            dataKey="value"
                                                        >
                                                            {overviewData.orderSource.map((entry, index) => (
                                                                <Cell key={`cell-${index}`} fill={entry.color} strokeWidth={0} />
                                                            ))}
                                                        </Pie>
                                                        <RechartsTooltip />
                                                        <Legend
                                                            verticalAlign="middle"
                                                            align="right"
                                                            layout="vertical"
                                                            iconType="circle"
                                                            wrapperStyle={{ fontSize: '11px', fontWeight: 600 }}
                                                        />
                                                    </PieChart>
                                                </ResponsiveContainer>
                                                {/* Center Icon */}
                                                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-slate-400">
                                                    <ShoppingBag className="w-6 h-6" />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* 4. Operational Insights & Recent Activity */}
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                    {/* Peak Hours Heatmap Style */}
                                    <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-100">
                                        <div className="flex items-center gap-3 mb-6">
                                            <div className="p-3 bg-orange-50 text-orange-500 rounded-2xl">
                                                <Activity className="w-6 h-6" />
                                            </div>
                                            <div>
                                                <h3 className="text-lg font-extrabold text-slate-800 font-display">Operational Intensity</h3>
                                                <p className="text-xs text-slate-500 font-medium">Live traffic analysis</p>
                                            </div>
                                        </div>
                                        <div className="space-y-5">
                                            {[
                                                { time: '12:00 PM - 03:00 PM', level: 'High', fill: 75, color: 'bg-orange-400' },
                                                { time: '03:00 PM - 06:00 PM', level: 'Moderate', fill: 45, color: 'bg-blue-400' },
                                                { time: '06:00 PM - 09:00 PM', level: 'Very High', fill: 90, color: 'bg-red-500' },
                                                { time: '09:00 PM - 12:00 AM', level: 'Low', fill: 30, color: 'bg-emerald-400' },
                                            ].map((slot, i) => {
                                                // Calculate real intensity if possible
                                                const hourRange = slot.time.split(' - ').map(t => parseInt(t.split(':')[0]) + (t.includes('PM') && t.split(':')[0] !== '12' ? 12 : 0));
                                                const slotOrders = fetchedStats?.hourlyData.filter(d => {
                                                    const h = parseInt(d.time.split(':')[0]);
                                                    return h >= hourRange[0] && h < hourRange[1];
                                                }).reduce((sum, d) => sum + d.orders, 0) || 0;

                                                const fillLevel = Math.min(100, (slotOrders / 10) * 100); // Scale 10 orders to 100% for demo
                                                const trafficLabel = fillLevel > 80 ? 'Very High' : (fillLevel > 50 ? 'High' : (fillLevel > 20 ? 'Moderate' : 'Low'));

                                                return (
                                                    <div key={i}>
                                                        <div className="flex justify-between text-xs font-bold text-slate-600 mb-2">
                                                            <span>{slot.time}</span>
                                                            <span className={`${trafficLabel === 'Very High' ? 'text-red-500' :
                                                                trafficLabel === 'High' ? 'text-orange-500' :
                                                                    trafficLabel === 'Moderate' ? 'text-blue-500' : 'text-emerald-500'
                                                                }`}>{trafficLabel} Traffic ({slotOrders} Orders)</span>
                                                        </div>
                                                        <div className="w-full bg-slate-50 h-3 rounded-full overflow-hidden border border-slate-100">
                                                            <div className={`h-full rounded-full ${slot.color} transition-all duration-1000`} style={{ width: `${fillLevel}%` }}></div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {/* Recent Branch Activity Log */}
                                    <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-100 flex flex-col">
                                        <div className="flex items-center gap-3 mb-6">
                                            <div className="p-3 bg-blue-50 text-blue-500 rounded-2xl">
                                                <Server className="w-6 h-6" />
                                            </div>
                                            <div>
                                                <h3 className="text-lg font-extrabold text-slate-800 font-display">Branch Activity Log</h3>
                                                <p className="text-xs text-slate-500 font-medium">Recent admin actions & updates</p>
                                            </div>
                                        </div>
                                        <div className="flex-1 overflow-y-auto no-scrollbar space-y-4 pr-2 max-h-[250px]">
                                            {[
                                                // Real Order Activities
                                                ...(fetchedLiveOrders || []).slice(0, 3).map(order => ({
                                                    action: 'New Order Received',
                                                    detail: `${order.customerName} placed an order for SAR ${order.total}`,
                                                    time: order.timestamp,
                                                    user: order.customerName === 'Guest' ? 'Bot' : 'App'
                                                })),
                                                // System Mock/Audit Logs
                                                { action: 'Menu Price Updated', detail: 'Increased price of "Zinger Burger" by 1 SAR', time: '10:45 AM', user: 'Manager' },
                                                { action: 'Stock Alert', detail: 'Chicken patties running low (below 50 units)', time: '09:30 AM', user: 'System' },
                                                { action: 'Branch Opened', detail: 'System initialized for daily operations', time: 'Yesterday', user: 'System' },
                                            ].map((log, i) => (
                                                <div key={i} className="flex gap-4 p-4 rounded-2xl border border-slate-50 bg-slate-50/50 hover:bg-slate-100 transition-colors">
                                                    <div className="mt-1">
                                                        <div className={`w-2 h-2 rounded-full ${log.user === 'System' ? 'bg-orange-400' : 'bg-blue-400'}`}></div>
                                                    </div>
                                                    <div>
                                                        <p className="text-sm font-bold text-slate-800">{log.action}</p>
                                                        <p className="text-xs text-slate-500 mt-0.5">{log.detail}</p>
                                                        <div className="flex gap-2 mt-2">
                                                            <span className="text-[10px] font-mono text-slate-400 bg-white px-2 py-0.5 rounded border border-slate-200">{log.time}</span>
                                                            <span className="text-[10px] font-mono text-slate-400 bg-white px-2 py-0.5 rounded border border-slate-200">{log.user}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                            </div>
                        )}

                        {/* TAB CONTENT: MENU */}
                        {activeTab === 'MENU' && (
                            <div className="bg-white rounded-[2.5rem] shadow-sm border border-slate-100 overflow-hidden animate-fade-in-up relative">
                                {/* Glassmorphism Background Decoration */}
                                <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-gradient-to-b from-blue-50/50 to-transparent rounded-bl-full opacity-60 pointer-events-none"></div>

                                <div className="p-8 border-b border-slate-100 flex flex-col sm:flex-row justify-between items-center gap-6 relative z-10">
                                    <div className="flex items-center gap-6">
                                        <h3 className="text-xl font-extrabold text-slate-800 flex items-center gap-3 font-display">
                                            <span className="w-2.5 h-8 bg-primary rounded-full"></span>
                                            Branch Menu List
                                        </h3>
                                        <div className="hidden lg:flex items-center gap-4">
                                            <div className="bg-slate-50 px-4 py-2 rounded-xl border border-slate-100 flex flex-col">
                                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Items</span>
                                                <span className="text-sm font-bold text-slate-700">{selectedBranch.menu.length}</span>
                                            </div>
                                            <div className="bg-slate-50 px-4 py-2 rounded-xl border border-slate-100 flex flex-col">
                                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Categories</span>
                                                <span className="text-sm font-bold text-slate-700">{categories.length - 1}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-4 w-full sm:w-auto">
                                        <div className="relative flex-1 sm:flex-initial">
                                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                                            <input type="text" placeholder="Search items..." value={menuSearch} onChange={(e) => setMenuSearch(e.target.value)} className="w-full sm:w-72 pl-12 pr-5 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-primary/20 text-sm font-medium" />
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => setIsUploadModalOpen(true)}
                                                className="flex items-center gap-2 px-6 py-3 bg-emerald-500 text-white rounded-2xl hover:bg-emerald-600 transition-colors shadow-lg shadow-emerald-500/20 font-bold text-sm whitespace-nowrap"
                                            >
                                                <Upload className="w-5 h-5" />
                                                <span className="hidden sm:inline">Bulk Upload</span>
                                            </button>
                                            <button onClick={() => setIsAddItemModalOpen(true)} className="flex items-center gap-2 px-6 py-3 bg-primary text-white rounded-2xl hover:bg-sky-600 transition-colors shadow-lg shadow-primary/20 font-bold text-sm whitespace-nowrap"><Plus className="w-5 h-5" /><span>Add Item</span></button>
                                        </div>
                                    </div>
                                </div>

                                {/* Categories */}
                                <div className="px-8 py-5 bg-slate-50/50 border-b border-slate-100 overflow-x-auto no-scrollbar relative z-10">
                                    <div className="flex gap-3">
                                        {categories.map(cat => (
                                            <button key={cat} onClick={() => { setSelectedCategory(cat); setSelectedSubcategory(null); }} className={`px-5 py-2.5 rounded-xl text-sm font-bold whitespace-nowrap transition-all ${selectedCategory === cat ? 'bg-slate-800 text-white shadow-lg' : 'bg-white text-slate-600 hover:bg-slate-200 border border-slate-200'}`}>{cat}</button>
                                        ))}
                                    </div>
                                </div>

                                {/* Subcategories (Dynamic - Only show if main category selected and has subcategories) */}
                                {subcategories.length > 0 && (
                                    <div className="px-8 py-3 bg-gradient-to-r from-blue-50/50 to-purple-50/50 border-b border-slate-100 overflow-x-auto no-scrollbar relative z-10">
                                        <div className="flex gap-2">
                                            {subcategories.map(subcat => (
                                                <button
                                                    key={subcat}
                                                    onClick={() => setSelectedSubcategory(subcat === 'All' ? null : subcat)}
                                                    className={`px-4 py-2 rounded-lg text-xs font-bold whitespace-nowrap transition-all ${(selectedSubcategory === subcat || (!selectedSubcategory && subcat === 'All'))
                                                        ? 'bg-blue-500 text-white shadow-md'
                                                        : 'bg-white text-slate-500 hover:bg-blue-100 border border-slate-200'
                                                        }`}
                                                >
                                                    {subcat}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* MODERN GRID TABLE: MENU */}
                                <div className="p-8 bg-slate-50/30 relative z-10 max-h-[calc(100vh-420px)] overflow-y-auto custom-scrollbar scroll-smooth">
                                    {/* Grid Header */}
                                    <div className="hidden md:grid grid-cols-12 gap-6 px-6 py-4 text-xs font-black text-slate-400 uppercase tracking-widest bg-white/90 rounded-2xl border border-slate-200/60 mb-4 backdrop-blur-md sticky top-0 z-30 shadow-sm">
                                        <div className="col-span-1">Category</div>
                                        <div className="col-span-2">Item Name (EN)</div>
                                        <div className="col-span-2">Stock Level</div>
                                        <div className="col-span-2">Availability</div>
                                        <div className="col-span-2 text-right">Item Name (AR)</div>
                                        <div className="col-span-1 text-center">Price</div>
                                        <div className="col-span-2 text-right">Actions</div>
                                    </div>

                                    {/* Grid Rows - Glass Cards */}
                                    <div className="space-y-3">
                                        {filteredMenu.map((item, index) => (
                                            <div
                                                key={item.key}
                                                className="grid grid-cols-1 md:grid-cols-12 gap-4 md:gap-6 items-center px-6 py-4 bg-white/60 backdrop-blur-sm rounded-2xl shadow-sm border border-white/50 hover:shadow-lg hover:shadow-slate-200/50 hover:bg-white/80 hover:border-blue-200 transition-all duration-500 group animate-fade-in-up"
                                                style={{ animationDelay: `${index * 30}ms` }}
                                            >
                                                {/* Category */}
                                                <div className="col-span-1 md:col-span-1 flex items-center gap-3">
                                                    {editingItemKey === item.key ? (
                                                        <select
                                                            className="w-full p-2 border border-blue-200 rounded-lg text-xs font-bold bg-slate-50"
                                                            value={editForm.category_id || item.category_id}
                                                            onChange={(e) => setEditForm({ ...editForm, category_id: e.target.value })}
                                                        >
                                                            {dbCategories.map(cat => (
                                                                <option key={cat.id} value={cat.id}>{cat.name_en}</option>
                                                            ))}
                                                        </select>
                                                    ) : (
                                                        <span className="px-2 py-1 bg-slate-100 rounded-lg text-[10px] font-bold text-slate-500 border border-slate-200">{item.category}</span>
                                                    )}
                                                </div>

                                                {/* Name EN */}
                                                <div className="col-span-1 md:col-span-2">
                                                    {editingItemKey === item.key ? (
                                                        <div className="space-y-1">
                                                            <input className="w-full p-2 border border-blue-200 rounded-lg text-sm font-bold" value={editForm.name_en} onChange={(e) => setEditForm({ ...editForm, name_en: e.target.value })} />
                                                            <input className="w-full p-2 border border-slate-200 rounded-lg text-[10px] font-medium placeholder:text-slate-300" placeholder="Subcategory..." value={editForm.subcategory || ''} onChange={(e) => setEditForm({ ...editForm, subcategory: e.target.value })} />
                                                        </div>
                                                    ) : (
                                                        <div className="flex flex-col">
                                                            <h4 className="text-sm font-extrabold text-slate-800 font-display">{item.name_en}</h4>
                                                            {item.subcategory && <span className="text-[10px] font-bold text-slate-400">{item.subcategory}</span>}
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Stock Level */}
                                                <div className="col-span-1 md:col-span-2">
                                                    <div className="flex flex-col gap-1">
                                                        <div className="flex items-center gap-2">
                                                            <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden border border-slate-200/50">
                                                                <div
                                                                    className={`h-full rounded-full transition-all duration-500 ${item.isOutOfStock || item.status === AvailabilityStatus.OUT_OF_STOCK ? 'bg-red-500' :
                                                                        (item.stock || 0) <= (item.minStockThreshold || 0) || item.status === AvailabilityStatus.LIMITED ? 'bg-orange-500 animate-pulse' : 'bg-emerald-500'
                                                                        }`}
                                                                    style={{ width: `${Math.min(100, ((item.stock || 0) / (item.minStockThreshold || 5) * 2) * 100)}%` }}
                                                                ></div>
                                                            </div>
                                                            <span className={`text-[10px] font-black ${item.isOutOfStock || item.status === AvailabilityStatus.OUT_OF_STOCK ? 'text-red-600' : (item.stock || 0) <= (item.minStockThreshold || 0) ? 'text-orange-600' : 'text-slate-500'}`}>
                                                                {item.stock || 0}
                                                            </span>
                                                        </div>
                                                        {item.isOutOfStock || item.status === AvailabilityStatus.OUT_OF_STOCK ? (
                                                            <span className="text-[8px] font-black text-red-500 uppercase tracking-widest flex items-center gap-1">
                                                                <XCircle className="w-2.5 h-2.5" /> Out of Stock
                                                            </span>
                                                        ) : (item.stock || 0) <= (item.minStockThreshold || 0) || item.status === AvailabilityStatus.LIMITED ? (
                                                            <span className="text-[8px] font-black text-orange-500 uppercase tracking-widest flex items-center gap-1 animate-pulse">
                                                                <AlertTriangle className="w-2.5 h-2.5" /> Critical Stock
                                                            </span>
                                                        ) : null}
                                                    </div>
                                                </div>

                                                {/* Availability Status Dropdown */}
                                                <div className="col-span-1 md:col-span-2">
                                                    <select
                                                        value={item.status}
                                                        onChange={async (e) => {
                                                            if (!selectedBranch) return;
                                                            const newStatus = e.target.value as AvailabilityStatus;

                                                            try {
                                                                // 1. Update in Supabase for persistence
                                                                const { error } = await supabase
                                                                    .from('menu_items')
                                                                    .update({
                                                                        status: newStatus,
                                                                        // Ensure isOutOfStock remains in sync if needed (though status is primary)
                                                                    })
                                                                    .eq('id', item.key);

                                                                if (error) {
                                                                    console.error('Error updating item status:', error);
                                                                    alert('Failed to update status in database.');
                                                                    return;
                                                                }

                                                                // 2. Update Local State
                                                                const updatedMenu = selectedBranch.menu.map(mi =>
                                                                    mi.key === item.key ? { ...mi, status: newStatus, isOutOfStock: newStatus === AvailabilityStatus.OUT_OF_STOCK } : mi
                                                                );
                                                                onUpdateBranchMenu(selectedBranch.id, updatedMenu);

                                                                // 3. Sync across tabs
                                                                syncService.broadcastMenuUpdate(selectedBranch.id, updatedMenu);
                                                            } catch (err) {
                                                                console.error('Status update failed:', err);
                                                            }
                                                        }}
                                                        className={`w-full p-2 rounded-xl text-[10px] font-black uppercase tracking-wider border transition-all ${item.status === AvailabilityStatus.AVAILABLE ? 'bg-emerald-50 text-emerald-600 border-emerald-200' :
                                                            item.status === AvailabilityStatus.LIMITED ? 'bg-orange-50 text-orange-600 border-orange-200' :
                                                                'bg-red-50 text-red-600 border-red-200'
                                                            }`}
                                                    >
                                                        <option value={AvailabilityStatus.AVAILABLE}>Available</option>
                                                        <option value={AvailabilityStatus.LIMITED}>Limited</option>
                                                        <option value={AvailabilityStatus.OUT_OF_STOCK}>Out of Stock</option>
                                                    </select>
                                                </div>

                                                {/* Name AR */}
                                                <div className="col-span-1 md:col-span-2 text-right md:pr-4">
                                                    {editingItemKey === item.key ? (
                                                        <input className="w-full p-2 border border-blue-200 rounded-lg text-sm font-bold text-right font-arabic" value={editForm.name_ar} onChange={(e) => setEditForm({ ...editForm, name_ar: e.target.value })} />
                                                    ) : (
                                                        <h4 className="text-sm font-bold text-slate-600 font-arabic">{item.name_ar}</h4>
                                                    )}
                                                </div>

                                                {/* Price */}
                                                <div className="col-span-1 md:col-span-1 text-center">
                                                    {editingItemKey === item.key ? (
                                                        <input type="number" step="0.5" className="w-16 p-2 border border-blue-200 rounded-lg text-center font-bold text-xs" value={editForm.price} onChange={(e) => setEditForm({ ...editForm, price: parseFloat(e.target.value) })} />
                                                    ) : (
                                                        <div className="flex flex-col items-center">
                                                            <span className="text-sm font-black text-slate-800">SAR {item.price.toFixed(0)}</span>
                                                            <span className="text-[10px] font-bold text-slate-400">≈ PK {(item.price * 74.5).toFixed(0)}</span>
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Actions */}
                                                <div className="col-span-1 md:col-span-2 flex justify-end gap-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-200">
                                                    {editingItemKey === item.key ? (
                                                        <>
                                                            <button onClick={handleSaveEdit} className="p-2.5 text-white bg-emerald-500 hover:bg-emerald-600 rounded-xl transition-all shadow-lg shadow-emerald-500/20"><Save className="w-4 h-4" /></button>
                                                            <button onClick={handleCancelEdit} className="p-2.5 text-white bg-red-500 hover:bg-red-600 rounded-xl transition-all shadow-lg shadow-red-500/20"><X className="w-4 h-4" /></button>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <button onClick={() => handleEditClick(item)} className="p-2.5 text-slate-400 hover:text-white hover:bg-primary rounded-xl transition-all bg-slate-50 border border-slate-100 hover:border-primary hover:shadow-lg hover:shadow-primary/20" title="Edit Item"><Edit className="w-4 h-4" /></button>
                                                            <button onClick={() => handleDeleteItem(item.key)} className="p-2.5 text-slate-400 hover:text-white hover:bg-red-500 rounded-xl transition-all bg-slate-50 border border-slate-100 hover:border-red-500 hover:shadow-lg hover:shadow-red-500/20" title="Delete Item"><Trash2 className="w-4 h-4" /></button>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* TAB CONTENT: SETTINGS */}
                        {activeTab === 'SETTINGS' && (
                            <div className="bg-white rounded-[2.5rem] shadow-sm border border-slate-100 overflow-hidden animate-fade-in-up relative">
                                <div className="p-8 border-b border-slate-100 bg-slate-50/30">
                                    <h3 className="text-xl font-extrabold text-slate-800 flex items-center gap-3 font-display">
                                        <Clock className="w-6 h-6 text-primary" />
                                        Operational Settings
                                    </h3>
                                </div>

                                <div className="p-8 space-y-10 max-h-[calc(100vh-350px)] overflow-y-auto custom-scrollbar scroll-smooth">
                                    {/* Branch Status Toggle */}
                                    <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm flex flex-col md:flex-row justify-between items-center gap-6">
                                        <div className="flex-1">
                                            <h4 className="text-lg font-extrabold text-slate-800 flex items-center gap-2">
                                                <Activity className={`w-5 h-5 ${selectedBranch.status === 'Active' ? 'text-emerald-500' : 'text-slate-400'}`} />
                                                Branch Status
                                            </h4>
                                            <p className="text-sm text-slate-500 font-medium mt-1">
                                                Current status is <span className={`font-black uppercase ${selectedBranch.status === 'Active' ? 'text-emerald-500' : 'text-red-500'}`}>{selectedBranch.status}</span>. Closed branches appear as "Closed" on the landing page.
                                            </p>
                                        </div>
                                        <div className="flex bg-slate-50 p-1.5 rounded-xl border border-slate-200">
                                            {(['Active', 'Closed', 'Maintenance'] as const).map((stats) => (
                                                <button
                                                    key={stats}
                                                    onClick={async () => {
                                                        try {
                                                            const { error } = await supabase
                                                                .from('branches')
                                                                .update({ status: stats })
                                                                .eq('id', selectedBranch.id);
                                                            if (error) throw error;
                                                            if (onUpdateBranch) onUpdateBranch({ ...selectedBranch, status: stats });
                                                        } catch (err: any) {
                                                            alert('Failed to update status: ' + err.message);
                                                        }
                                                    }}
                                                    className={`px-6 py-3 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${selectedBranch.status === stats
                                                        ? 'bg-white text-slate-800 shadow-md border border-slate-100'
                                                        : 'text-slate-400 hover:text-slate-600 hover:bg-slate-200/50'
                                                        }`}
                                                >
                                                    {stats}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    {/* Holiday Mode Master Switch */}
                                    <div className="bg-orange-50/50 p-8 rounded-[2rem] border border-orange-100 flex flex-col md:flex-row justify-between items-center gap-6">
                                        <div className="flex-1">
                                            <h4 className="text-lg font-extrabold text-orange-900 flex items-center gap-2">
                                                <AlertTriangle className="w-5 h-5" /> Holiday Mode
                                            </h4>
                                            <p className="text-sm text-orange-700 font-medium mt-1">Temporarily close this branch for all orders. A custom notice will be shown to customers.</p>
                                            {selectedBranch.settings.holidayMode.active && (
                                                <input
                                                    type="text"
                                                    className="mt-4 w-full p-3 bg-white border border-orange-200 rounded-xl text-sm font-bold focus:ring-2 focus:ring-orange-200"
                                                    value={selectedBranch.settings.holidayMode.notice}
                                                    onChange={(e) => handleUpdateBranchSettings({
                                                        ...selectedBranch.settings,
                                                        holidayMode: { ...selectedBranch.settings.holidayMode, notice: e.target.value }
                                                    })}
                                                    placeholder="Enter closing notice..."
                                                />
                                            )}
                                        </div>
                                        <button
                                            onClick={() => handleUpdateBranchSettings({
                                                ...selectedBranch.settings,
                                                holidayMode: { ...selectedBranch.settings.holidayMode, active: !selectedBranch.settings.holidayMode.active }
                                            })}
                                            className={`px-8 py-4 rounded-2xl font-black text-xs uppercase tracking-widest transition-all ${selectedBranch.settings.holidayMode.active ? 'bg-orange-500 text-white shadow-xl shadow-orange-500/20' : 'bg-white text-orange-600 border border-orange-200 hover:bg-orange-50'}`}
                                        >
                                            {selectedBranch.settings.holidayMode.active ? 'Disable Holiday Mode' : 'Enable Holiday Mode'}
                                        </button>
                                    </div>

                                    {/* Weekly Schedule */}
                                    <div className="space-y-6">
                                        <div className="flex items-center justify-between">
                                            <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                                                <CalendarDays className="w-4 h-4" /> Weekly Operating Hours
                                            </h4>
                                            <div className="flex items-center gap-2">
                                                <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Auto-Status Active</span>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 gap-3">
                                            {(Object.entries(selectedBranch.settings.workingDays) as [string, OperationalHours][]).map(([day, hours]) => (
                                                <div key={day} className={`flex flex-col md:flex-row md:items-center justify-between p-5 rounded-2xl border transition-all ${hours.isClosed ? 'bg-slate-50 border-slate-100 opacity-60' : 'bg-white border-slate-200 shadow-sm hover:border-primary/30'}`}>
                                                    <div className="flex items-center gap-4 min-w-[140px]">
                                                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-xs ${hours.isClosed ? 'bg-slate-200 text-slate-400' : 'bg-blue-50 text-primary border border-blue-100'}`}>
                                                            {day.substring(0, 3)}
                                                        </div>
                                                        <span className="text-sm font-extrabold text-slate-700">{day}</span>
                                                    </div>

                                                    <div className="flex flex-wrap items-center gap-6 mt-4 md:mt-0">
                                                        {!hours.isClosed ? (
                                                            <>
                                                                <div className="flex items-center gap-3">
                                                                    <label className="text-[10px] font-black text-slate-400 uppercase">Open</label>
                                                                    <input
                                                                        type="time"
                                                                        value={hours.open}
                                                                        onChange={(e) => {
                                                                            const updatedDays = { ...selectedBranch.settings.workingDays, [day]: { ...hours, open: e.target.value } };
                                                                            handleUpdateBranchSettings({ ...selectedBranch.settings, workingDays: updatedDays });
                                                                        }}
                                                                        className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-black text-slate-600"
                                                                    />
                                                                </div>
                                                                <div className="flex items-center gap-3">
                                                                    <label className="text-[10px] font-black text-slate-400 uppercase">Close</label>
                                                                    <input
                                                                        type="time"
                                                                        value={hours.close}
                                                                        onChange={(e) => {
                                                                            const updatedDays = { ...selectedBranch.settings.workingDays, [day]: { ...hours, close: e.target.value } };
                                                                            handleUpdateBranchSettings({ ...selectedBranch.settings, workingDays: updatedDays });
                                                                        }}
                                                                        className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-black text-slate-600"
                                                                    />
                                                                </div>
                                                            </>
                                                        ) : (
                                                            <div className="flex items-center gap-2 text-slate-400 italic text-sm font-medium">
                                                                <XCircle className="w-4 h-4" /> Not operational on this day
                                                            </div>
                                                        )}

                                                        <div className="h-8 w-px bg-slate-100 hidden md:block mx-2"></div>

                                                        <button
                                                            onClick={() => {
                                                                const updatedDays = { ...selectedBranch.settings.workingDays, [day]: { ...hours, isClosed: !hours.isClosed } };
                                                                handleUpdateBranchSettings({ ...selectedBranch.settings, workingDays: updatedDays });
                                                            }}
                                                            className={`px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all ${hours.isClosed ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-red-50 text-red-500 border border-red-100 hover:bg-red-100'}`}
                                                        >
                                                            {hours.isClosed ? 'Open This Day' : 'Mark as Closed'}
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                        {activeTab === 'CUSTOMERS' && (
                            <div className="bg-white rounded-[2.5rem] shadow-sm border border-slate-100 overflow-hidden animate-fade-in-up relative">
                                {/* Glassmorphism Background Decoration */}
                                <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-gradient-to-b from-purple-50/50 to-transparent rounded-bl-full opacity-60 pointer-events-none"></div>
                                {/* Increased z-index to stay above the sticky header table */}
                                <div className="p-8 border-b border-slate-100 flex flex-col md:flex-row justify-between items-center gap-6 relative z-[60]">
                                    <div className="flex flex-col">
                                        <h3 className="text-xl font-extrabold text-slate-800 flex items-center gap-3 font-display">
                                            <Users className="w-6 h-6 text-primary" />
                                            {customerSubTab === 'USERS' ? 'Registered Users' : 'Campaign Insights'}
                                        </h3>
                                        {customerSubTab === 'USERS' && (
                                            <div className="flex items-center gap-4 mt-1.5 pl-9">
                                                <div className="flex items-center gap-1.5 bg-slate-100/80 px-2 py-1 rounded-lg border border-slate-200/50">
                                                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Members:</span>
                                                    <span className="text-[10px] font-black text-slate-700">{filteredStats.count}</span>
                                                </div>
                                                <div className="flex items-center gap-1.5 bg-blue-50/80 px-2 py-1 rounded-lg border border-blue-100/50">
                                                    <span className="text-[9px] font-black text-blue-400 uppercase tracking-widest">Spent:</span>
                                                    <span className="text-[10px] font-black text-blue-700">SAR {filteredStats.totalSpent.toLocaleString()}</span>
                                                </div>
                                                <div className="flex items-center gap-1.5 bg-emerald-50/80 px-2 py-1 rounded-lg border border-emerald-100/50">
                                                    <span className="text-[9px] font-black text-emerald-400 uppercase tracking-widest">Orders:</span>
                                                    <span className="text-[10px] font-black text-emerald-700">{filteredStats.totalOrders}</span>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    <div className="flex items-center bg-slate-100 p-1 rounded-2xl border border-slate-200 shadow-inner">
                                        <button
                                            onClick={() => setCustomerSubTab('USERS')}
                                            className={`px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${customerSubTab === 'USERS' ? 'bg-white text-primary shadow-md border border-slate-100' : 'text-slate-400 hover:text-slate-600'}`}
                                        >
                                            User Database
                                        </button>
                                        <button
                                            onClick={() => setCustomerSubTab('CAMPAIGNS')}
                                            className={`px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${customerSubTab === 'CAMPAIGNS' ? 'bg-white text-primary shadow-md border border-slate-100' : 'text-slate-400 hover:text-slate-600'}`}
                                        >
                                            Campaign Tracking
                                        </button>
                                    </div>

                                    <div className="flex items-center gap-3 w-full md:w-auto">
                                        {customerSubTab === 'USERS' ? (
                                            <>
                                                {/* Filter Dropdown */}
                                                <div className="relative z-20">
                                                    <button
                                                        onClick={() => setIsSortDropdownOpen(!isSortDropdownOpen)}
                                                        className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-black text-slate-600 hover:bg-slate-50 transition-all shadow-sm"
                                                    >
                                                        <Filter className="w-3.5 h-3.5 text-primary" />
                                                        <span className="hidden sm:inline">
                                                            {customerFilter === 'all' ? 'All Users' :
                                                                customerFilter === 'inactive_5' ? 'Inactive (5d)' :
                                                                    customerFilter === 'inactive_10' ? 'Inactive (10d)' :
                                                                        customerFilter === 'inactive_20' ? 'Inactive (20d)' :
                                                                            customerFilter === 'inactive_30' ? 'Inactive (30d)' :
                                                                                customerFilter === 'inactive_45' ? 'Inactive (45d)' :
                                                                                    customerFilter === 'inactive_60' ? 'Inactive (60d)' :
                                                                                        customerFilter === 'inactive_90' ? 'Inactive (90d)' :
                                                                                            customerFilter === 'custom' ? 'Custom Range' : 'Custom'}
                                                        </span>
                                                        <ChevronDown className="w-3.5 h-3.5" />
                                                    </button>
                                                    {isSortDropdownOpen && (
                                                        <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-xl shadow-xl border border-slate-100 overflow-hidden animate-pop p-1.5 z-[70]">
                                                            {[
                                                                { id: 'all', label: 'All Users' },
                                                                { id: 'inactive_5', label: 'Inactive > 5 Days' },
                                                                { id: 'inactive_10', label: 'Inactive > 10 Days' },
                                                                { id: 'inactive_20', label: 'Inactive > 20 Days' },
                                                                { id: 'inactive_30', label: 'Inactive > 30 Days' },
                                                                { id: 'inactive_45', label: 'Inactive > 45 Days' },
                                                                { id: 'inactive_60', label: 'Inactive > 60 Days' },
                                                                { id: 'inactive_90', label: 'Inactive > 90 Days' },
                                                                { id: 'custom', label: 'Custom Range' }
                                                            ].map(opt => (
                                                                <button
                                                                    key={opt.id}
                                                                    onClick={() => { setCustomerFilter(opt.id as any); setIsSortDropdownOpen(false); }}
                                                                    className={`w-full text-left px-4 py-2.5 rounded-lg text-xs font-bold transition-all ${customerFilter === opt.id ? 'bg-orange-50 text-orange-600' : 'text-slate-500 hover:bg-slate-50'}`}
                                                                >
                                                                    {opt.label}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>

                                                {customerFilter === 'custom' && (
                                                    <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-2xl border border-slate-200 shadow-sm animate-pop">
                                                        <input
                                                            type="date"
                                                            value={customerInactivityRange.start}
                                                            onChange={(e) => setCustomerInactivityRange({ ...customerInactivityRange, start: e.target.value })}
                                                            className="text-xs font-bold p-1 border-none bg-transparent outline-none cursor-pointer text-slate-600"
                                                        />
                                                        <span className="text-slate-300 font-bold text-xs">to</span>
                                                        <input
                                                            type="date"
                                                            value={customerInactivityRange.end}
                                                            onChange={(e) => setCustomerInactivityRange({ ...customerInactivityRange, end: e.target.value })}
                                                            className="text-xs font-bold p-1 border-none bg-transparent outline-none cursor-pointer text-slate-600"
                                                        />
                                                    </div>
                                                )}

                                                <button
                                                    onClick={() => ReportsService.generateCustomerExport(filteredCustomers, `Customers_${selectedBranch?.name || 'All'}_${new Date().toISOString().split('T')[0]}`)}
                                                    className="flex items-center gap-2 px-5 py-3 bg-emerald-500 text-white rounded-2xl hover:bg-emerald-600 transition-colors shadow-lg shadow-emerald-500/20 font-bold text-sm whitespace-nowrap"
                                                >
                                                    <Download className="w-4 h-4" />
                                                    <span className="hidden md:inline">Export Excel</span>
                                                </button>

                                                <div className="relative w-full sm:w-72">
                                                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                                                    <input type="text" placeholder="Search users..." value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} className="w-full pl-12 pr-5 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-primary/20 text-sm font-medium" />
                                                </div>
                                            </>
                                        ) : (
                                            <button
                                                onClick={fetchCampaigns}
                                                className="flex items-center gap-2 px-5 py-3 bg-blue-50 text-blue-600 rounded-2xl hover:bg-blue-100 transition-colors border border-blue-100 font-bold text-sm whitespace-nowrap"
                                            >
                                                <RefreshCcw className={`w-4 h-4 ${isLoadingCampaigns ? 'animate-spin' : ''}`} />
                                                Refresh Data
                                            </button>
                                        )}
                                    </div>
                                </div>

                                <div className="max-h-[calc(100vh-350px)] overflow-y-auto custom-scrollbar relative">
                                    {customerSubTab === 'USERS' ? (
                                        <div className="p-8 bg-slate-50/30 relative z-10 scroll-smooth">
                                            {/* Grid Header - Glass Effect */}
                                            <div className="hidden lg:grid grid-cols-12 gap-6 px-6 py-4 text-xs font-black text-slate-400 uppercase tracking-widest bg-white/90 rounded-2xl border border-slate-200/60 mb-4 backdrop-blur-md sticky top-0 z-30 shadow-sm">
                                                <div className="col-span-3">User Profile</div>
                                                <div className="col-span-3">Contact Info</div>
                                                <div className="col-span-2">Join Date</div>
                                                <div className="col-span-1 text-center">Orders</div>
                                                <div className="col-span-1 text-center">Spent</div>
                                                <div className="col-span-2 text-right">Actions</div>
                                            </div>

                                            {/* Grid Rows - Glass Cards */}
                                            <div className="space-y-3">
                                                {filteredCustomers.map((customer, index) => (
                                                    <div
                                                        key={customer.id}
                                                        className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center px-6 py-5 bg-white/60 backdrop-blur-sm rounded-2xl shadow-sm border border-white/50 hover:shadow-lg hover:shadow-slate-200/50 hover:bg-white/80 hover:border-blue-200 transition-all duration-500 group animate-fade-in-up"
                                                        style={{ animationDelay: `${index * 50}ms` }}
                                                    >
                                                        {/* Profile */}
                                                        <div className="col-span-1 lg:col-span-3 flex items-center gap-4">
                                                            <div className="relative shrink-0">
                                                                <img src={customer.avatar} alt={customer.name} className="w-12 h-12 rounded-2xl border-2 border-white shadow-md group-hover:scale-110 transition-transform" />
                                                                <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-emerald-500 border-2 border-white rounded-full shadow-sm"></div>
                                                            </div>
                                                            <div>
                                                                <p className="text-sm font-extrabold text-slate-800 font-display">{customer.name}</p>
                                                                <p className="text-[10px] font-mono text-slate-400 mt-1 bg-slate-50/50 px-2 py-0.5 rounded-md inline-block border border-slate-100">{customer.id}</p>
                                                            </div>
                                                        </div>

                                                        {/* Contact */}
                                                        <div className="col-span-1 lg:col-span-3">
                                                            <div className="flex flex-col gap-1.5">
                                                                <div className="flex items-center gap-2 text-sm font-bold text-slate-600 bg-slate-50/50 px-3 py-1 rounded-lg border border-slate-100 w-fit">
                                                                    <Mail className="w-3.5 h-3.5 text-slate-400" />
                                                                    {customer.email}
                                                                </div>
                                                                <div className="flex items-center gap-2 text-xs font-medium text-slate-500 px-1">
                                                                    <Phone className="w-3.5 h-3.5 text-slate-400" />
                                                                    {customer.phone}
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {/* Interaction Tracking */}
                                                        <div className="col-span-1 lg:col-span-2">
                                                            <div className="flex flex-col gap-1.5">
                                                                <div className="flex items-center gap-2 text-sm font-bold text-slate-600">
                                                                    <Calendar className="w-4 h-4 text-slate-300" />
                                                                    {customer.joinDate}
                                                                </div>
                                                                {customer.lastInteraction && (
                                                                    <div className="flex items-center gap-2 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-100 w-fit">
                                                                        <Clock className="w-3 h-3" />
                                                                        Vis: {new Date(customer.lastInteraction).toLocaleDateString()}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>

                                                        {/* Orders */}
                                                        <div className="col-span-1 lg:col-span-1 flex justify-center">
                                                            <div className="flex items-center justify-center bg-blue-50 text-blue-600 border border-blue-100 rounded-xl w-14 h-12 flex-col shadow-sm group-hover:bg-blue-500 group-hover:text-white group-hover:border-blue-500 transition-colors">
                                                                <span className="text-lg font-black">{customer.totalOrders}</span>
                                                            </div>
                                                        </div>

                                                        {/* Spent */}
                                                        <div className="col-span-1 lg:col-span-1 flex justify-center">
                                                            <div className="flex items-center justify-center bg-emerald-50 text-emerald-600 border border-emerald-100 rounded-xl w-full h-12 shadow-sm px-2 group-hover:bg-emerald-500 group-hover:text-white group-hover:border-emerald-500 transition-colors">
                                                                <span className="text-xs font-bold mr-0.5">SAR</span>
                                                                <span className="text-sm font-black">{customer.totalSpent.toFixed(0)}</span>
                                                            </div>
                                                        </div>

                                                        {/* Actions */}
                                                        <div className="col-span-1 lg:col-span-2 flex justify-end gap-2 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity duration-200">
                                                            <button
                                                                onClick={() => setSelectedCustomer(customer)}
                                                                className="p-2.5 text-emerald-600 hover:text-white hover:bg-emerald-500 rounded-xl transition-all bg-emerald-50 border border-emerald-100 hover:border-emerald-500 hover:shadow-lg hover:shadow-emerald-500/20 group/history"
                                                                title="View Order History ($)"
                                                            >
                                                                <DollarSign className="w-4 h-4 group-hover/history:scale-125 transition-transform" />
                                                            </button>
                                                            <button onClick={() => openEditCustomer(customer)} className="p-2.5 text-slate-500 hover:text-white hover:bg-orange-500 rounded-xl transition-all bg-white border border-slate-100 hover:border-orange-500 hover:shadow-lg hover:shadow-orange-500/20" title="Edit User">
                                                                <Edit className="w-4 h-4" />
                                                            </button>
                                                            <button onClick={() => handleDeleteCustomer(customer.id)} className="p-2.5 text-slate-500 hover:text-white hover:bg-red-500 rounded-xl transition-all bg-white border border-slate-100 hover:border-red-500 hover:shadow-lg hover:shadow-red-500/20" title="Delete User">
                                                                <Trash2 className="w-4 h-4" />
                                                            </button>
                                                        </div>
                                                    </div>
                                                ))}

                                                {filteredCustomers.length === 0 && (
                                                    <div className="p-16 text-center">
                                                        <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-slate-200 border-dashed">
                                                            <Search className="w-6 h-6 text-slate-300" />
                                                        </div>
                                                        <p className="text-slate-500 font-medium">No users found matching your search.</p>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="p-8 space-y-8 animate-fade-in-up">
                                            {isLoadingCampaigns ? (
                                                <div className="flex flex-col items-center justify-center p-20 space-y-4">
                                                    <Loader2 className="w-12 h-12 text-primary animate-spin" />
                                                    <p className="text-slate-500 font-bold animate-pulse">Loading campaign stats...</p>
                                                </div>
                                            ) : campaigns.length === 0 ? (
                                                <div className="text-center py-20 bg-slate-50/50 rounded-[2rem] border-2 border-dashed border-slate-200">
                                                    <div className="w-20 h-20 bg-white rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-sm border border-slate-100">
                                                        <Bot className="w-10 h-10 text-slate-300" />
                                                    </div>
                                                    <h4 className="text-lg font-black text-slate-800">No Campaigns Yet</h4>
                                                    <p className="text-sm text-slate-500 font-medium mt-2 max-w-sm mx-auto">
                                                        Start a promotional campaign from the "Discounts" section to see results here.
                                                    </p>
                                                </div>
                                            ) : (
                                                <div className="grid grid-cols-1 gap-6">
                                                    {campaigns.map((camp) => (
                                                        <div key={camp.id} className="bg-white rounded-[2rem] border border-slate-100 shadow-sm hover:shadow-xl hover:border-primary/20 transition-all duration-500 overflow-hidden group">
                                                            <div className="p-8">
                                                                <div className="flex flex-col lg:flex-row justify-between items-start gap-6 mb-8">
                                                                    <div className="flex-1">
                                                                        <div className="flex items-center gap-3 mb-2">
                                                                            <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${camp.status === 'Active' ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
                                                                                {camp.status}
                                                                            </span>
                                                                            <span className="text-xs font-bold text-slate-400">Sent on {new Date(camp.created_at).toLocaleDateString()}</span>
                                                                        </div>
                                                                        <h4 className="text-xl font-black text-slate-800 font-display group-hover:text-primary transition-colors">{camp.name}</h4>
                                                                        <p className="text-sm text-slate-500 font-medium mt-2 line-clamp-2 italic">"{camp.message}"</p>
                                                                    </div>
                                                                    <div className="flex items-center gap-3 bg-slate-50 p-2 rounded-2xl self-start lg:self-center border border-slate-100">
                                                                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-3">Target:</span>
                                                                        <span className="bg-white px-4 py-1.5 rounded-xl text-xs font-black text-slate-700 shadow-sm">
                                                                            {camp.audience.replace('_', ' ')}
                                                                        </span>
                                                                    </div>
                                                                </div>

                                                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                                                    {[
                                                                        { label: 'Reached', val: camp.sent_count, icon: Users, color: 'blue' },
                                                                        { label: 'Opened', val: camp.read_count, icon: Mail, color: 'emerald', percent: Math.round((camp.read_count / (camp.sent_count || 1)) * 100) },
                                                                        { label: 'Clicked', val: camp.click_count, icon: Zap, color: 'orange', percent: Math.round((camp.click_count / (camp.sent_count || 1)) * 100) },
                                                                        { label: 'Responded', val: camp.respond_count, icon: Bot, color: 'purple' }
                                                                    ].map((stat) => (
                                                                        <div key={stat.label} className={`p-4 rounded-2xl bg-${stat.color}-50/50 border border-${stat.color}-100/50 flex flex-col`}>
                                                                            <div className="flex items-center justify-between mb-2">
                                                                                <stat.icon className={`w-4 h-4 text-${stat.color}-500 opacity-60`} />
                                                                                {stat.percent !== undefined && (
                                                                                    <span className={`text-[10px] font-black text-${stat.color}-600 bg-white px-2 py-0.5 rounded-md`}>{stat.percent}%</span>
                                                                                )}
                                                                            </div>
                                                                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{stat.label}</span>
                                                                            <span className={`text-2xl font-black text-${stat.color}-700 font-display mt-1`}>{stat.val || 0}</span>
                                                                        </div>
                                                                    ))}
                                                                </div>

                                                                <div className="mt-8 space-y-2">
                                                                    <div className="flex justify-between text-[10px] font-black uppercase tracking-widest text-slate-400">
                                                                        <span>Engagement Progress</span>
                                                                        <span>{Math.round(((camp.read_count || 0) / (camp.sent_count || 1)) * 100)}% Conversion</span>
                                                                    </div>
                                                                    <div className="h-3 bg-slate-100 rounded-full overflow-hidden flex shadow-inner">
                                                                        <div
                                                                            className="h-full bg-emerald-500 shadow-lg shadow-emerald-500/20 transition-all duration-1000 ease-out"
                                                                            style={{ width: `${(camp.read_count / (camp.sent_count || 1)) * 100}%` }}
                                                                        ></div>
                                                                        <div
                                                                            className="h-full bg-orange-400 shadow-lg shadow-orange-500/20 transition-all duration-1000 ease-out delay-200"
                                                                            style={{ width: `${(camp.click_count / (camp.sent_count || 1)) * 100}%` }}
                                                                        ></div>
                                                                    </div>
                                                                    <div className="flex gap-4 mt-2">
                                                                        <div className="flex items-center gap-1.5">
                                                                            <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-sm animate-pulse"></div>
                                                                            <span className="text-[9px] font-bold text-slate-400 uppercase">Read</span>
                                                                        </div>
                                                                        <div className="flex items-center gap-1.5">
                                                                            <div className="w-2 h-2 rounded-full bg-orange-400 shadow-sm animate-pulse"></div>
                                                                            <span className="text-[9px] font-bold text-slate-400 uppercase">Clicked</span>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* TAB CONTENT: STAFF MANAGEMENT */}
                        {activeTab === 'STAFF' && selectedBranch && (
                            <div className="animate-fade-in-up">
                                {!selectedStaff ? (
                                    <div className="space-y-8">
                                        <div className="flex justify-between items-center">
                                            <div>
                                                <h2 className="text-2xl font-extrabold text-slate-800 font-display">Staff Members</h2>
                                                <p className="text-slate-500 font-medium">Manage your team, shifts, and performance metrics.</p>
                                            </div>
                                            <button
                                                onClick={() => setIsAddStaffModalOpen(true)}
                                                className="bg-primary text-white px-6 py-3 rounded-xl font-bold hover:bg-blue-600 transition-colors shadow-lg shadow-blue-500/30 flex items-center gap-2"
                                            >
                                                <Plus className="w-5 h-5" />
                                                Add Staff
                                            </button>
                                        </div>

                                        {/* Staff Metrics Overview */}
                                        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                                            <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm relative overflow-hidden">
                                                <div className="relative z-10">
                                                    <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-1">Total Staff</p>
                                                    <h3 className="text-3xl font-black text-slate-800 font-display">{(selectedBranch.staff || []).length}</h3>
                                                </div>
                                                <div className="absolute top-0 right-0 p-4 opacity-5">
                                                    <Users className="w-24 h-24" />
                                                </div>
                                            </div>
                                            <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm relative overflow-hidden">
                                                <div className="relative z-10">
                                                    <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-1">Active Now</p>
                                                    <h3 className="text-3xl font-black text-emerald-600 font-display">
                                                        {(selectedBranch.staff || []).filter(s => s.status === 'Active').length}
                                                    </h3>
                                                </div>
                                            </div>
                                            <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm relative overflow-hidden">
                                                <div className="relative z-10">
                                                    <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-1">Total Payroll</p>
                                                    <h3 className="text-3xl font-black text-slate-800 font-display">
                                                        {formatCurrency((selectedBranch.staff || []).reduce((acc, s) => acc + s.financials.salary, 0)).sar} <span className="text-sm font-bold text-slate-400">SAR</span>
                                                    </h3>
                                                </div>
                                            </div>
                                            <div className="bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm relative overflow-hidden">
                                                <div className="relative z-10">
                                                    <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-1">Avg Success Rate</p>
                                                    <h3 className="text-3xl font-black text-indigo-600 font-display">
                                                        {((selectedBranch.staff || []).reduce((acc, s) => acc + s.metrics.successRate, 0) / ((selectedBranch.staff || []).length || 1)).toFixed(1)}%
                                                    </h3>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Staff List Grid */}
                                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                                            {(selectedBranch.staff || []).map(staff => (
                                                <div
                                                    key={staff.id}
                                                    onClick={() => setSelectedStaff(staff)}
                                                    className="bg-white rounded-[2rem] p-6 border border-slate-100 shadow-sm hover:shadow-xl hover:shadow-slate-200/50 transition-all group cursor-pointer"
                                                >
                                                    <div className="flex items-start justify-between mb-6">
                                                        <div className="flex items-center gap-4">
                                                            <div className="relative">
                                                                <img src={staff.avatar} className="w-16 h-16 rounded-2xl shadow-md group-hover:scale-105 transition-transform" alt={staff.name} />
                                                                <div className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-white ${staff.status === 'Active' ? 'bg-emerald-500' : 'bg-slate-400'}`}></div>
                                                            </div>
                                                            <div>
                                                                <h4 className="text-lg font-extrabold text-slate-800 font-display">{staff.name}</h4>
                                                                <div className="flex items-center gap-2 mt-1">
                                                                    <span className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded-md text-[10px] font-black uppercase tracking-wide">
                                                                        {staff.role}
                                                                    </span>
                                                                    <span className="text-xs text-slate-400 font-bold">• {staff.phone}</span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div className="p-2 text-slate-300 group-hover:text-primary rounded-xl transition-all">
                                                            <ChevronRight className="w-5 h-5" />
                                                        </div>
                                                    </div>

                                                    <div className="grid grid-cols-3 gap-4 mb-6">
                                                        <div className="bg-slate-50 p-3 rounded-xl border border-slate-100/50">
                                                            <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1">Orders</div>
                                                            <div className="text-sm font-black text-slate-700">{staff.metrics.lifetimeOrders || 0}</div>
                                                        </div>
                                                        <div className="bg-slate-50 p-3 rounded-xl border border-slate-100/50">
                                                            <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1">Accuracy</div>
                                                            <div className="text-sm font-black text-emerald-600">{staff.metrics.successRate}%</div>
                                                        </div>
                                                        <div className="bg-slate-50 p-3 rounded-xl border border-slate-100/50">
                                                            <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-1">Shift</div>
                                                            <div className="text-xs font-bold text-slate-700">{staff.shift.start} - {staff.shift.end}</div>
                                                        </div>
                                                    </div>

                                                    <div className="flex items-center justify-between pt-4 border-t border-slate-50">
                                                        <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
                                                            <Clock className="w-4 h-4 text-slate-300" />
                                                            Joined {new Date(staff.joinDate).toLocaleDateString()}
                                                        </div>
                                                        <div className="flex items-center gap-1">
                                                            {[1, 2, 3, 4, 5].map(star => (
                                                                <Star key={star} className={`w-3.5 h-3.5 ${star <= staff.metrics.rating ? 'text-yellow-400 fill-yellow-400' : 'text-slate-200'}`} />
                                                            ))}
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ) : (
                                    <StaffDetailView
                                        staff={selectedStaff}
                                        onClose={() => setSelectedStaff(null)}
                                        onUpdate={async (updated) => {
                                            if (!selectedBranch) return;
                                            const updatedStaff = (selectedBranch.staff || []).map(s => s.id === updated.id ? updated : s);

                                            // 1. Update State
                                            const updatedBranch = { ...selectedBranch, staff: updatedStaff };
                                            setBranchesList(prev => prev.map(b => b.id === selectedBranch.id ? updatedBranch : b));

                                            // 2. Sync & Log
                                            syncService.broadcastStaffUpdate(selectedBranch.id, updatedStaff);
                                            logAction('UPDATE', `Updated staff details: ${updated.name}`);
                                        }}
                                        onDelete={(staffId) => {
                                            if (!selectedBranch) return;
                                            const updatedStaff = (selectedBranch.staff || []).filter(s => s.id !== staffId);

                                            // 1. Update State
                                            const updatedBranch = { ...selectedBranch, staff: updatedStaff };
                                            setSelectedStaff(null);
                                            setBranchesList(prev => prev.map(b => b.id === selectedBranch.id ? updatedBranch : b));

                                            // 2. Sync & Log
                                            syncService.broadcastStaffUpdate(selectedBranch.id, updatedStaff);
                                            logAction('DELETE', `Removed staff member: ${staffId}`);
                                        }}
                                    />
                                )}
                            </div>
                        )}
                    </>
                )}
            </div>
        );
    }

    // --- VIEW: ALL BRANCHES ---
    return (
        <div className="space-y-8 animate-fade-in-up pb-10">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-100">
                <div>
                    <h2 className="text-3xl font-extrabold text-slate-800 tracking-tight font-display">Branch Network</h2>
                    <p className="text-slate-500 font-medium mt-1">Manage and monitor all restaurant locations ({branchesList.length} total)</p>
                </div>
                <div className="flex items-center gap-4 w-full md:w-auto">
                    <div className="relative flex-1 md:w-80">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                        <input
                            type="text"
                            placeholder="Search branches, locations, or managers..."
                            value={branchSearch}
                            onChange={(e) => setBranchSearch(e.target.value)}
                            className="w-full pl-12 pr-5 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:ring-4 focus:ring-primary/10 transition-all text-sm font-medium"
                        />
                    </div>
                    <button
                        onClick={() => setIsAddBranchModalOpen(true)}
                        className={`flex items-center gap-2 px-6 py-3.5 bg-primary text-white rounded-2xl hover:bg-sky-600 transition-all shadow-lg shadow-primary/30 font-bold text-sm whitespace-nowrap transform active:scale-95 ${!allowAddBranch ? 'hidden' : ''}`}
                    >
                        <Plus className="w-5 h-5" />
                        <span>Add Branch</span>
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
                {filteredBranches.map((branch, idx) => {
                    const status = getBranchStatus(branch);
                    // Note: using internal hook logic directly in the mapped component for better control
                    return (
                        <BranchCard
                            key={branch.id}
                            branch={branch}
                            idx={idx}
                            status={status}
                            onDelete={handleDeleteBranch}
                            onManage={() => setSelectedBranchId(branch.id)}
                        />
                    );
                })}

                {/* Placeholder for adding branch */}
                {allowAddBranch && (
                    <button
                        onClick={() => setIsAddBranchModalOpen(true)}
                        className="rounded-[2.5rem] border-4 border-dashed border-slate-100 flex flex-col items-center justify-center p-12 hover:border-primary/30 hover:bg-blue-50/30 transition-all duration-500 group min-h-[400px]"
                    >
                        <div className="w-20 h-20 bg-slate-50 rounded-[2rem] flex items-center justify-center text-slate-300 mb-6 group-hover:scale-110 group-hover:bg-primary group-hover:text-white transition-all duration-500 shadow-sm">
                            <Plus className="w-10 h-10" />
                        </div>
                        <p className="text-lg font-extrabold text-slate-400 group-hover:text-primary transition-colors font-display">Add New Location</p>
                        <p className="text-sm font-medium text-slate-300 mt-2">Expand your reach</p>
                    </button>
                )}
            </div>

            {/* ... (Existing Modals: EditCustomer, AddItem, AddBranch) ... */}

            {/* --- ADD STAFF MODAL --- */}
            {isAddStaffModalOpen && createPortal(
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 backdrop-blur-md p-4 animate-fade-in-up">
                    <div className="bg-white rounded-[2rem] p-8 w-full max-w-lg shadow-2xl border border-slate-100 animate-pop overflow-y-auto max-h-[90vh]">
                        <div className="flex justify-between items-center mb-6">
                            <div>
                                <h3 className="text-xl font-extrabold text-slate-800 font-display">Add New Staff</h3>
                                <p className="text-slate-500 font-medium text-sm">Create a profile for your team member</p>
                            </div>
                            <button onClick={() => setIsAddStaffModalOpen(false)} className="p-2 hover:bg-slate-50 rounded-full transition-colors text-slate-400 hover:text-red-500">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Full Name</label>
                                    <input
                                        type="text"
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-bold text-slate-700 outline-none focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10 transition-all"
                                        placeholder="e.g. John Doe"
                                        value={newStaffForm.name || ''}
                                        onChange={e => setNewStaffForm({ ...newStaffForm, name: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Role</label>
                                    <select
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-bold text-slate-700 outline-none focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10 transition-all appearance-none"
                                        value={newStaffForm.role}
                                        onChange={e => setNewStaffForm({ ...newStaffForm, role: e.target.value as StaffRole })}
                                    >
                                        {Object.values(StaffRole).map(role => (
                                            <option key={role} value={role}>{role}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Email</label>
                                    <input
                                        type="email"
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-bold text-slate-700 outline-none focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10 transition-all"
                                        placeholder="email@example.com"
                                        value={newStaffForm.email || ''}
                                        onChange={e => setNewStaffForm({ ...newStaffForm, email: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Phone</label>
                                    <input
                                        type="tel"
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-bold text-slate-700 outline-none focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10 transition-all"
                                        placeholder="+966 5..."
                                        value={newStaffForm.phone || ''}
                                        onChange={e => setNewStaffForm({ ...newStaffForm, phone: e.target.value })}
                                    />
                                </div>
                            </div>

                            <div className="h-px bg-slate-100 my-2"></div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Start Time</label>
                                    <input
                                        type="time"
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-bold text-slate-700 outline-none focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10 transition-all"
                                        value={newStaffForm.shift?.start || ''}
                                        onChange={e => setNewStaffForm({ ...newStaffForm, shift: { ...newStaffForm.shift!, start: e.target.value } })}
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">End Time</label>
                                    <input
                                        type="time"
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-bold text-slate-700 outline-none focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10 transition-all"
                                        value={newStaffForm.shift?.end || ''}
                                        onChange={e => setNewStaffForm({ ...newStaffForm, shift: { ...newStaffForm.shift!, end: e.target.value } })}
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">Monthly Salary (SAR)</label>
                                <input
                                    type="number"
                                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 font-bold text-slate-700 outline-none focus:border-primary focus:bg-white focus:ring-4 focus:ring-primary/10 transition-all"
                                    placeholder="3000"
                                    value={newStaffForm.financials?.salary || 0}
                                    onChange={e => setNewStaffForm({ ...newStaffForm, financials: { ...newStaffForm.financials!, salary: Number(e.target.value) } })}
                                    min="0"
                                />
                            </div>

                        </div>

                        <div className="flex items-center gap-3 mt-8">
                            <button
                                onClick={() => setIsAddStaffModalOpen(false)}
                                className="flex-1 py-3.5 bg-slate-50 text-slate-600 rounded-xl font-bold hover:bg-slate-100 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleAddStaff}
                                className="flex-[2] py-3.5 bg-primary text-white rounded-xl font-bold hover:bg-blue-600 shadow-lg shadow-blue-500/20 transition-all transform active:scale-95"
                            >
                                Create Staff Profile
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
            {isEditCustomerModalOpen && editCustomerForm && createPortal(
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 backdrop-blur-md p-4 animate-fade-in-up">
                    <div className="bg-white rounded-[2rem] p-8 w-full max-w-md shadow-2xl border border-slate-100 animate-pop">
                        <h3 className="text-xl font-extrabold text-slate-800 mb-6 font-display">Edit Customer Details</h3>
                        <div className="space-y-4">
                            <div>
                                <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Full Name</label>
                                <input className="w-full p-3 border border-slate-200 rounded-xl mt-1.5 text-sm font-medium focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all" value={editCustomerForm.name} onChange={e => setEditCustomerForm({ ...editCustomerForm, name: e.target.value })} />
                            </div>
                            <div>
                                <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Email</label>
                                <input className="w-full p-3 border border-slate-200 rounded-xl mt-1.5 text-sm font-medium focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all" value={editCustomerForm.email} onChange={e => setEditCustomerForm({ ...editCustomerForm, email: e.target.value })} />
                            </div>
                            <div>
                                <label className="text-xs font-black text-slate-400 uppercase tracking-widest">Phone</label>
                                <input className="w-full p-3 border border-slate-200 rounded-xl mt-1.5 text-sm font-medium focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all" value={editCustomerForm.phone} onChange={e => setEditCustomerForm({ ...editCustomerForm, phone: e.target.value })} />
                            </div>
                        </div>
                        <div className="mt-8 flex justify-end gap-3">
                            <button onClick={() => setIsEditCustomerModalOpen(false)} className="px-6 py-3 text-slate-600 hover:bg-slate-100 rounded-xl text-sm font-bold transition-colors">Cancel</button>
                            <button onClick={saveCustomerEdit} className="px-6 py-3 bg-primary text-white rounded-xl text-sm font-bold shadow-lg shadow-primary/20 hover:bg-sky-600 transition-all">Save Changes</button>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {isAddItemModalOpen && createPortal(
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 backdrop-blur-md p-4 animate-fade-in-up">
                    <div className="bg-white rounded-[2rem] p-8 w-full max-w-lg shadow-2xl border border-slate-100 animate-pop">
                        <div className="flex justify-between items-center mb-8">
                            <h3 className="text-xl font-extrabold text-slate-800 font-display">Add New Menu Item</h3>
                            <button onClick={() => setIsAddItemModalOpen(false)} className="text-slate-400 hover:text-slate-600 transition-colors bg-slate-50 p-2 rounded-full hover:bg-slate-100">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="col-span-1">
                                    <label className="block text text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Category</label>
                                    <select
                                        className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-primary text-sm font-bold"
                                        value={newItemForm.category_id}
                                        onChange={(e) => setNewItemForm({ ...newItemForm, category_id: e.target.value })}
                                    >
                                        <option value="">Select Category</option>
                                        {dbCategories.map(cat => (
                                            <option key={cat.id} value={cat.id}>{cat.name_en}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="col-span-1">
                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Subcategory</label>
                                    <input
                                        type="text"
                                        className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-primary text-sm font-medium"
                                        placeholder="e.g. Red Pizza"
                                        value={newItemForm.subcategory || ''}
                                        onChange={(e) => setNewItemForm({ ...newItemForm, subcategory: e.target.value })}
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="col-span-1">
                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Name (EN)</label>
                                    <input
                                        type="text"
                                        className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-primary text-sm font-bold"
                                        placeholder="Item name"
                                        value={newItemForm.name_en || ''}
                                        onChange={(e) => setNewItemForm({ ...newItemForm, name_en: e.target.value })}
                                    />
                                </div>
                                <div className="col-span-1">
                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Name (AR)</label>
                                    <input
                                        type="text"
                                        className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-primary text-sm font-bold text-right"
                                        placeholder="الاسم"
                                        dir="rtl"
                                        value={newItemForm.name_ar || ''}
                                        onChange={(e) => setNewItemForm({ ...newItemForm, name_ar: e.target.value })}
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="col-span-1">
                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Price (SAR)</label>
                                    <input
                                        type="number"
                                        className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-primary text-sm font-bold"
                                        value={newItemForm.price || ''}
                                        onChange={(e) => setNewItemForm({ ...newItemForm, price: parseFloat(e.target.value) })}
                                    />
                                </div>
                                <div className="col-span-1">
                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Cuisine Type</label>
                                    <select
                                        className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:border-primary text-sm font-bold"
                                        value={newItemForm.cuisine_type}
                                        onChange={(e) => setNewItemForm({ ...newItemForm, cuisine_type: e.target.value })}
                                    >
                                        <option value="General">General</option>
                                        <option value="Fast Food">Fast Food</option>
                                        <option value="Desi">Desi</option>
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Available Meal Times</label>
                                <div className="grid grid-cols-2 gap-2">
                                    {['Breakfast', 'Lunch', 'Dinner', 'High Tea'].map(meal => (
                                        <label key={meal} className="flex items-center gap-2 p-2 bg-slate-50 border border-slate-100 rounded-lg cursor-pointer hover:bg-slate-100 transition-colors">
                                            <input
                                                type="checkbox"
                                                className="w-4 h-4 text-primary rounded"
                                                checked={newItemForm.available_meals?.includes(meal)}
                                                onChange={(e) => {
                                                    const current = newItemForm.available_meals || [];
                                                    const updated = e.target.checked
                                                        ? [...current, meal]
                                                        : current.filter(m => m !== meal);
                                                    setNewItemForm({ ...newItemForm, available_meals: updated });
                                                }}
                                            />
                                            <span className="text-xs font-bold text-slate-600">{meal}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="mt-10 flex gap-4">
                            <button
                                onClick={() => setIsAddItemModalOpen(false)}
                                className="flex-1 py-3.5 bg-slate-100 text-slate-600 rounded-xl font-bold hover:bg-slate-200 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleAddItem}
                                className="flex-1 py-3.5 bg-primary text-white rounded-xl font-bold hover:bg-sky-600 shadow-lg shadow-primary/30 transition-all transform active:scale-95"
                            >
                                Add Item
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {isAddBranchModalOpen && createPortal(
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 backdrop-blur-md p-4 animate-fade-in-up">
                    <div className="bg-white rounded-[2.5rem] p-8 w-full max-w-xl shadow-2xl border border-slate-100 animate-pop max-h-[90vh] overflow-y-auto no-scrollbar">
                        <div className="flex justify-between items-center mb-8">
                            <h3 className="text-2xl font-extrabold text-slate-800 font-display">Add New Branch</h3>
                            <button
                                onClick={() => setIsAddBranchModalOpen(false)}
                                className="text-slate-400 hover:text-slate-600 transition-colors bg-slate-50 p-2 rounded-full hover:bg-slate-100"
                            >
                                <X className="w-6 h-6" />
                            </button>
                        </div>

                        <div className="space-y-6">
                            <div className="col-span-2">
                                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1.5">Branch Name</label>
                                <input type="text" className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold focus:outline-none focus:border-primary focus:ring-4 focus:ring-primary/10" placeholder="e.g., Downtown Branch" value={newBranchData.name} onChange={(e) => setNewBranchData({ ...newBranchData, name: e.target.value })} />
                            </div>

                            <div className="bg-slate-50 p-6 rounded-3xl border border-slate-100 space-y-6">
                                <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400"></span> Operational Details
                                </h4>
                                <div className="grid grid-cols-2 gap-5">
                                    <div className="col-span-1"><label className="block text-xs font-bold text-slate-500 mb-1.5">Manager</label><input type="text" className="w-full p-3 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:border-primary" value={newBranchData.manager} onChange={(e) => setNewBranchData({ ...newBranchData, manager: e.target.value })} /></div>
                                    <div className="col-span-1"><label className="block text-xs font-bold text-slate-500 mb-1.5">Email</label><input type="email" className="w-full p-3 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:border-primary" value={newBranchData.email} onChange={(e) => setNewBranchData({ ...newBranchData, email: e.target.value })} /></div>
                                    <div className="col-span-1"><label className="block text-xs font-bold text-slate-500 mb-1.5">Phone</label><input type="text" className="w-full p-3 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:border-primary" value={newBranchData.phone} onChange={(e) => setNewBranchData({ ...newBranchData, phone: e.target.value })} /></div>
                                    <div className="col-span-1"><label className="block text-xs font-bold text-slate-500 mb-1.5">Location</label><input type="text" className="w-full p-3 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:border-primary" value={newBranchData.address} onChange={(e) => setNewBranchData({ ...newBranchData, address: e.target.value })} /></div>
                                </div>
                            </div>

                            <div className="bg-orange-50/50 p-6 rounded-3xl border border-orange-100 space-y-6">
                                <h4 className="text-xs font-black text-orange-400 uppercase tracking-widest flex items-center gap-2">
                                    <span className="w-1.5 h-1.5 rounded-full bg-orange-400"></span> Owner Details
                                </h4>
                                <div className="grid grid-cols-2 gap-5">
                                    <div className="col-span-2"><label className="block text-xs font-bold text-slate-500 mb-1.5">Owner Name</label><input type="text" className="w-full p-3 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:border-orange-400" value={newBranchData.ownerName} onChange={(e) => setNewBranchData({ ...newBranchData, ownerName: e.target.value })} /></div>
                                    <div className="col-span-1"><label className="block text-xs font-bold text-slate-500 mb-1.5">Owner Email</label><input type="email" className="w-full p-3 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:border-orange-400" value={newBranchData.ownerEmail} onChange={(e) => setNewBranchData({ ...newBranchData, ownerEmail: e.target.value })} /></div>
                                    <div className="col-span-1"><label className="block text-xs font-bold text-slate-500 mb-1.5">Owner Phone</label><input type="text" className="w-full p-3 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:border-orange-400" value={newBranchData.ownerPhone} onChange={(e) => setNewBranchData({ ...newBranchData, ownerPhone: e.target.value })} /></div>
                                </div>
                            </div>

                            <div className="bg-blue-50/50 p-6 rounded-3xl border border-blue-100 space-y-6">
                                <h4 className="text-xs font-black text-primary uppercase tracking-widest flex items-center gap-2">
                                    <span className="w-1.5 h-1.5 rounded-full bg-primary"></span> Dashboard Access
                                </h4>
                                <div className="grid grid-cols-2 gap-5">
                                    <div className="col-span-1"><label className="block text-xs font-bold text-slate-500 mb-1.5">Owner Username</label><input type="text" className="w-full p-3 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:border-primary" value={newBranchData.ownerUsername} onChange={(e) => setNewBranchData({ ...newBranchData, ownerUsername: e.target.value })} /></div>
                                    <div className="col-span-1"><label className="block text-xs font-bold text-slate-500 mb-1.5">Owner Password</label><input type="text" className="w-full p-3 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:border-primary" value={newBranchData.ownerPassword} onChange={(e) => setNewBranchData({ ...newBranchData, ownerPassword: e.target.value })} /></div>
                                </div>
                            </div>

                        </div>

                        <div className="mt-10 flex gap-4">
                            <button
                                onClick={() => setIsAddBranchModalOpen(false)}
                                className="flex-1 py-4 bg-slate-100 text-slate-600 rounded-2xl font-bold hover:bg-slate-200 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSubmitNewBranch}
                                className="flex-1 py-4 bg-primary text-white rounded-2xl font-bold shadow-lg shadow-primary/30 hover:bg-sky-600 transition-all transform active:scale-95"
                            >
                                Create Branch
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {(() => {
                if (selectedKitchenOrder) console.log('DEBUG: Rendering Portal for order:', selectedKitchenOrder.id);
                return selectedKitchenOrder;
            })() && createPortal(
                <KitchenDetailModal
                    order={selectedKitchenOrder}
                    staff={selectedBranch?.staff || []}
                    onClose={() => setSelectedKitchenOrder(null)}
                    onUpdateOrder={handleKitchenUpdate}
                />,
                document.body
            )}
        </div>
    );
};

export default BranchManager;

// --- 3D Branch Card Component ---
const BranchCard: React.FC<{
    branch: Branch;
    idx: number;
    status: { status: string; label: string };
    onDelete: (id: string) => void;
    onManage: () => void;
}> = ({ branch, idx, status, onDelete, onManage }) => {
    const { ref, style, handleMouseMove, handleMouseLeave } = use3DTilt();

    return (
        <div
            ref={ref}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            className="group relative bg-white rounded-[2.5rem] border border-slate-100 shadow-sm transition-all duration-500 overflow-visible flex flex-col animate-fade-in-up"
            style={{ ...style, animationDelay: `${idx * 150}ms`, transformStyle: 'preserve-3d' }}
        >
            {/* Card Content with 3D layers */}
            <div className="p-10 flex-1 relative z-10" style={{ transform: 'translateZ(10px)' }}>
                <div className="flex justify-between items-start mb-8">
                    <div className={`p-5 rounded-3xl ${branch.status === 'Active' ? 'bg-gradient-to-br from-blue-500 to-sky-400 text-white shadow-lg shadow-blue-500/20' : 'bg-slate-100 text-slate-400'} group-hover:rotate-12 transition-all duration-500`} style={{ transform: 'translateZ(25px)' }}>
                        <MapPin className="w-8 h-8" />
                    </div>
                    <div className="flex flex-col items-end gap-2.5" style={{ transform: 'translateZ(15px)' }}>
                        <span className={`px-5 py-2 rounded-full text-[10px] font-black uppercase tracking-[0.15em] border backdrop-blur-md shadow-sm transition-all duration-500 ${status.status === 'Open' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' :
                            status.status.includes('Soon') ? 'bg-orange-500/10 text-orange-600 border-orange-500/20 animate-pulse' :
                                'bg-slate-500/10 text-slate-500 border-slate-500/20'
                            }`}>
                            <span className="flex items-center gap-1.5">
                                <span className={`w-1.5 h-1.5 rounded-full ${status.status === 'Open' ? 'bg-emerald-500 animate-pulse' : status.status.includes('Soon') ? 'bg-orange-500' : 'bg-slate-400'}`}></span>
                                {status.label}
                            </span>
                        </span>
                        {branch.status === 'Inactive' && (
                            <span className="px-3 py-1 bg-red-50 text-red-500 rounded-lg text-[8px] font-black uppercase tracking-widest border border-red-100">Master Disabled</span>
                        )}
                    </div>
                </div>

                <h3 className="text-2xl font-extrabold text-slate-800 mb-2 font-display group-hover:text-primary transition-colors tracking-tight" style={{ transform: 'translateZ(20px)' }}>{branch.name}</h3>
                <p className="text-slate-500 text-sm font-medium mb-8 flex items-center gap-1.5" style={{ transform: 'translateZ(15px)' }}>
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-300"></span>
                    {branch.location}
                </p>

                <div className="grid grid-cols-2 gap-4 pt-8 border-t border-slate-50" style={{ transform: 'translateZ(5px)' }}>
                    <div className="bg-slate-50/50 p-4 rounded-2xl border border-transparent hover:border-blue-100 transition-colors group/stat">
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Manager</p>
                        <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center text-primary group-hover/stat:rotate-12 transition-transform"><User className="w-3.5 h-3.5" /></div>
                            <p className="text-xs font-bold text-slate-700 truncate">{branch.manager}</p>
                        </div>
                    </div>
                    <div className="bg-slate-50/50 p-4 rounded-2xl border border-transparent hover:border-purple-100 transition-colors group/stat">
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Contact</p>
                        <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-purple-100 flex items-center justify-center text-purple-600 group-hover/stat:rotate-12 transition-transform"><Phone className="w-3.5 h-3.5" /></div>
                            <p className="text-xs font-bold text-slate-700 truncate">{branch.phone}</p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="p-8 bg-slate-50/30 border-t border-slate-100 flex gap-4 relative z-10 rounded-b-[2.5rem]" style={{ transform: 'translateZ(10px)' }}>
                <button
                    onClick={onManage}
                    className="flex-[2] flex items-center justify-center gap-3 py-4 bg-slate-900 text-white rounded-[1.25rem] font-bold text-sm hover:bg-primary hover:shadow-xl hover:shadow-primary/20 transition-all duration-300 transform active:scale-95 group/btn"
                >
                    <span>Manage Details</span>
                    <ArrowRight className="w-4 h-4 group-hover/btn:translate-x-1 transition-transform" />
                </button>
                <button
                    onClick={() => onDelete(branch.id)}
                    className="flex-1 flex items-center justify-center p-4 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-[1.25rem] transition-all border border-slate-200 hover:border-red-200 transform active:scale-95 shadow-sm"
                    title="Delete Branch"
                >
                    <Trash2 className="w-5 h-5 flex-shrink-0" />
                </button>
            </div>
        </div>
    );
};