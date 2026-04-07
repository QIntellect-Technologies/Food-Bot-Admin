import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { LoyaltyRule, UserRole } from '../types';
import { Plus, Gift, Award, Users, Trash2, X, Search, Filter, TrendingUp, DollarSign } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const LoyaltyManager: React.FC = () => {
    const { userRole, loggedInBranchId } = useAuth();
    const [view, setView] = useState<'LIST' | 'CREATE' | 'EDIT'>('LIST'); // Page Navigation
    const [activeTab, setActiveTab] = useState<'RULES' | 'CUSTOMERS'>('RULES');

    // Data State
    const [rules, setRules] = useState<LoyaltyRule[]>([]);
    const [loading, setLoading] = useState(true);
    const [customers, setCustomers] = useState<any[]>([]);
    const [customerLoading, setCustomerLoading] = useState(false);

    // Filters & Search
    const [customerSearch, setCustomerSearch] = useState('');
    const [customerFilter, setCustomerFilter] = useState<'ALL' | 'NEW' | 'VIP' | 'INACTIVE'>('ALL');
    const [selectedBranchId, setSelectedBranchId] = useState<string>('ALL'); // For Admin filtering/assignment
    const [branches, setBranches] = useState<any[]>([]); // To populate dropdown

    // Rule Form State
    const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
    const [ruleForm, setRuleForm] = useState<Partial<LoyaltyRule>>({
        type: 'EARN_RULE',
        condition_type: 'SPEND_AMOUNT',
        condition_value: 100,
        reward_type: 'POINTS',
        reward_value: 10,
        target_audience: 'ALL_USERS',
        is_active: true,
        start_date: new Date().toISOString().split('T')[0],
        end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    });

    useEffect(() => {
        fetchRules();
        if (userRole === UserRole.MAIN_ADMIN) fetchBranches();
    }, [loggedInBranchId, selectedBranchId]); // Refetch if filter changes

    useEffect(() => {
        if (activeTab === 'CUSTOMERS') {
            fetchCustomers();
        }
    }, [activeTab, customerFilter]);

    const fetchBranches = async () => {
        const { data } = await supabase.from('branches').select('id, name_en');
        setBranches(data || []);
    };

    const fetchRules = async () => {
        setLoading(true);
        let query = supabase.from('loyalty_rules').select('*').order('created_at', { ascending: false });

        // Filter by branch if specific one selected (or if logged in as branch admin)
        if (loggedInBranchId) {
            query = query.or(`branch_id.eq.${loggedInBranchId},branch_id.is.null`); // Branch sees global + own
        } else if (selectedBranchId !== 'ALL') {
            query = query.eq('branch_id', selectedBranchId);
        }

        const { data, error } = await query;
        if (error) console.error('Error fetching rules:', error);
        else setRules(data || []);
        setLoading(false);
    };

    const fetchCustomers = async () => {
        setCustomerLoading(true);
        let query = supabase.from('customers').select('*').order('loyalty_points', { ascending: false });

        if (customerFilter === 'VIP') {
            query = query.eq('loyalty_tier', 'Gold');
        } else if (customerFilter === 'NEW') {
            // Assuming created_at exists or using low order count
            query = query.eq('total_orders', 1);
        } else if (customerFilter === 'INACTIVE') {
            // Demo logic: last_order_date > 30 days ago (schema dependent, simpler: low points but high spent?)
            // For now just show those with 0 points but > 0 spent
            query = query.eq('loyalty_points', 0).gt('total_spent', 0);
        }

        const { data, error } = await query;
        if (error) console.error('Error fetching customers:', error);
        else setCustomers(data || []);
        setCustomerLoading(false);
    };

    const handleSaveRule = async () => {
        if (!ruleForm.name || !ruleForm.condition_value || !ruleForm.reward_value) {
            alert("Please fill all required fields.");
            return;
        }

        const payload = {
            ...ruleForm,
            branch_id: loggedInBranchId || (selectedBranchId !== 'ALL' ? selectedBranchId : undefined) // Default to global if ALL
        };
        if (editingRuleId) {
            const { error } = await supabase.from('loyalty_rules').update(payload).eq('id', editingRuleId);
            if (error) alert(error.message);
        } else {
            const { error } = await supabase.from('loyalty_rules').insert(payload);
            if (error) alert(error.message);
        }

        setView('LIST');
        setEditingRuleId(null);
        setRuleForm({
            type: 'EARN_RULE',
            condition_type: 'SPEND_AMOUNT',
            condition_value: 100,
            reward_type: 'POINTS',
            reward_value: 10,
            target_audience: 'ALL_USERS',
            is_active: true,
            start_date: new Date().toISOString().split('T')[0],
            end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
        });
        fetchRules();
    };

    const handleDeleteRule = async (id: string) => {
        if (!confirm('Are you sure you want to delete this rule?')) return;
        await supabase.from('loyalty_rules').delete().eq('id', id);
        fetchRules();
    };

    // --- RENDER HELPERS ---

    if (view === 'CREATE' || view === 'EDIT') {
        return (
            <div className="animate-fade-in-up pb-20">
                {/* Page Header (Breadcrumb style) */}
                <div className="flex items-center gap-4 mb-8">
                    <button onClick={() => setView('LIST')} className="p-3 bg-white hover:bg-slate-50 rounded-2xl text-slate-400 transition-colors">
                        <TrendingUp className="w-6 h-6 rotate-180" />
                    </button>
                    <div>
                        <h2 className="text-3xl font-extrabold text-slate-800 font-display uppercase tracking-tight">
                            {view === 'EDIT' ? 'Edit Rule' : 'Create New Rule'}
                        </h2>
                        <p className="text-slate-500 font-medium">Define logic for points, rewards, and tiers.</p>
                    </div>
                </div>

                <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-100 max-w-4xl">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
                        <div className="space-y-3">
                            <label className="text-xs font-black text-slate-400 uppercase tracking-widest ml-1">Rule Name</label>
                            <input
                                type="text"
                                className="w-full p-4 bg-slate-50 rounded-2xl border-none outline-none font-bold text-slate-700 focus:ring-2 focus:ring-primary/20 text-lg"
                                placeholder="e.g. Spend & Earn"
                                value={ruleForm.name || ''}
                                onChange={e => setRuleForm({ ...ruleForm, name: e.target.value })}
                            />
                        </div>

                        {/* Branch Selection (Only for Main Admin) */}
                        {userRole === UserRole.MAIN_ADMIN && (
                            <div className="space-y-3">
                                <label className="text-xs font-black text-slate-400 uppercase tracking-widest ml-1">Applicable Branch</label>
                                <select
                                    className="w-full p-4 bg-slate-50 rounded-2xl border-none outline-none font-bold text-slate-700 appearance-none cursor-pointer"
                                    value={ruleForm.branch_id || (selectedBranchId !== 'ALL' ? selectedBranchId : '')}
                                    onChange={(e: any) => setRuleForm({ ...ruleForm, branch_id: e.target.value || undefined })}
                                >
                                    <option value="">Global (All Branches)</option>
                                    {branches.map(b => <option key={b.id} value={b.id}>{b.name_en}</option>)}
                                </select>
                            </div>
                        )}
                    </div>

                    <div className="p-8 bg-slate-50 rounded-[2rem] space-y-8 mb-8 border border-slate-100/50">
                        <h4 className="text-sm font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                            <Filter className="w-4 h-4" /> Rule Logic
                        </h4>

                        <div className="flex flex-col md:flex-row items-center gap-6">
                            <div className="flex-1 w-full space-y-3">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">If Customer...</label>
                                <div className="flex gap-3">
                                    <select
                                        className="w-1/3 p-4 bg-white rounded-2xl text-xs font-bold border-none shadow-sm"
                                        value={ruleForm.condition_type}
                                        onChange={(e) => setRuleForm({ ...ruleForm, condition_type: e.target.value as any })}
                                    >
                                        <option value="SPEND_AMOUNT">Spends</option>
                                        <option value="ORDER_COUNT">Orders</option>
                                    </select>
                                    <div className="flex-1 relative">
                                        <span className="absolute left-4 top-1/2 -translate-y-1/2 font-black text-slate-300">$</span>
                                        <input
                                            type="number"
                                            className="w-full p-4 pl-8 bg-white rounded-2xl text-sm font-bold border-none outline-none shadow-sm"
                                            value={ruleForm.condition_value}
                                            onChange={e => setRuleForm({ ...ruleForm, condition_value: Number(e.target.value) })}
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="text-slate-300 font-bold hidden md:block"><TrendingUp className="w-6 h-6 rotate-90" /></div>

                            <div className="flex-1 w-full space-y-3">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Then They Get...</label>
                                <div className="flex gap-3">
                                    <select
                                        className="w-2/3 p-4 bg-white rounded-2xl text-xs font-bold border-none shadow-sm"
                                        value={ruleForm.reward_type}
                                        onChange={(e) => setRuleForm({ ...ruleForm, reward_type: e.target.value as any })}
                                    >
                                        <option value="POINTS">Points</option>
                                        <option value="DISCOUNT_PERCENT">% Discount</option>
                                        <option value="DISCOUNT_FIXED">$ Discount</option>
                                    </select>
                                    <div className="flex-1 relative">
                                        <input
                                            type="number"
                                            className="w-full p-4 bg-white rounded-2xl text-sm font-bold border-none outline-none shadow-sm text-center"
                                            value={ruleForm.reward_value}
                                            onChange={e => setRuleForm({ ...ruleForm, reward_value: Number(e.target.value) })}
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="flex gap-4">
                        <div className="flex-1 space-y-3">
                            <label className="text-xs font-black text-slate-400 uppercase tracking-widest ml-1">Start Date</label>
                            <input
                                type="date"
                                className="w-full p-4 bg-slate-50 rounded-2xl border-none outline-none font-bold text-slate-700 focus:ring-2 focus:ring-primary/20 text-sm"
                                value={ruleForm.start_date || ''}
                                onChange={e => setRuleForm({ ...ruleForm, start_date: e.target.value })}
                            />
                        </div>
                        <div className="flex-1 space-y-3">
                            <label className="text-xs font-black text-slate-400 uppercase tracking-widest ml-1">End Date</label>
                            <input
                                type="date"
                                className="w-full p-4 bg-slate-50 rounded-2xl border-none outline-none font-bold text-slate-700 focus:ring-2 focus:ring-primary/20 text-sm"
                                value={ruleForm.end_date || ''}
                                onChange={e => setRuleForm({ ...ruleForm, end_date: e.target.value })}
                            />
                        </div>
                    </div>

                    <div className="flex justify-end gap-4 pt-4 border-t border-slate-50">
                        <button
                            onClick={() => setView('LIST')}
                            className="px-8 py-4 rounded-2xl bg-white text-slate-500 font-bold text-sm hover:bg-slate-50 border border-slate-100"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSaveRule}
                            className="px-10 py-4 rounded-2xl bg-primary text-white font-bold text-sm shadow-xl shadow-primary/20 hover:bg-sky-600 hover:scale-[1.02] transition-all"
                        >
                            Save Rule
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // LIST VIEW
    return (
        <div className="space-y-8 pb-20 animate-fade-in-up">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-100 relative overflow-hidden">
                <div className="absolute right-0 top-0 w-64 h-64 bg-primary/5 rounded-full -mr-32 -mt-32 blur-3xl" />
                <div className="relative z-10">
                    <h2 className="text-3xl font-extrabold text-slate-800 font-display uppercase tracking-tight">Loyalty Program</h2>
                    <p className="text-slate-500 font-medium mt-1">Manage rewards, tiers, and customer retention strategies.</p>
                </div>

                <div className="flex gap-2 relative z-10">
                    <button
                        onClick={() => setActiveTab('RULES')}
                        className={`px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest transition-all ${activeTab === 'RULES' ? 'bg-slate-800 text-white shadow-lg' : 'bg-white text-slate-400 border border-slate-100'}`}
                    >
                        Rules Engine
                    </button>
                    <button
                        onClick={() => setActiveTab('CUSTOMERS')}
                        className={`px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest transition-all ${activeTab === 'CUSTOMERS' ? 'bg-slate-800 text-white shadow-lg' : 'bg-white text-slate-400 border border-slate-100'}`}
                    >
                        Loyalty Database
                    </button>
                </div>
            </div>

            {/* RULES TAB */}
            {activeTab === 'RULES' && (
                <>
                    <div className="flex justify-between items-center">
                        {/* Branch Filtering for Main Admin logic could go here */}
                        <div className="flex items-center gap-2">
                            {userRole === UserRole.MAIN_ADMIN && (
                                <select
                                    className="p-3 bg-white rounded-xl text-xs font-bold border border-slate-100 outline-none text-slate-600"
                                    value={selectedBranchId}
                                    onChange={(e) => setSelectedBranchId(e.target.value)}
                                >
                                    <option value="ALL">All Branches</option>
                                    {branches.map(b => <option key={b.id} value={b.id}>{b.name_en}</option>)}
                                </select>
                            )}
                        </div>

                        <button
                            onClick={() => {
                                setEditingRuleId(null);
                                setRuleForm({ type: 'EARN_RULE', condition_type: 'SPEND_AMOUNT', condition_value: 100, reward_type: 'POINTS', reward_value: 10, target_audience: 'ALL_USERS', is_active: true });
                                setView('CREATE');
                            }}
                            className="flex items-center gap-2 px-6 py-3.5 bg-primary text-white rounded-2xl hover:bg-sky-600 transition-all shadow-lg shadow-primary/30 font-bold text-sm uppercase tracking-wider"
                        >
                            <Plus className="w-5 h-5" />
                            <span>Create New Rule</span>
                        </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {loading ? (
                            [1, 2, 3].map(i => <div key={i} className="h-64 bg-slate-100 rounded-[2.5rem] animate-pulse" />)
                        ) : rules.length === 0 ? (
                            <div className="col-span-full py-20 text-center">
                                <Gift className="w-16 h-16 text-slate-200 mx-auto mb-4" />
                                <h3 className="text-xl font-bold text-slate-400">No active loyalty rules</h3>
                                <p className="text-slate-400 text-sm mt-1">Create your first rule to start rewarding customers.</p>
                            </div>
                        ) : (
                            rules.map(rule => (
                                <div key={rule.id} className="bg-white p-8 rounded-[2.5rem] border border-slate-100 shadow-sm hover:shadow-xl transition-all relative group overflow-hidden">
                                    <div className={`absolute top-0 right-0 p-4 rounded-bl-3xl text-[10px] font-black uppercase tracking-widest ${rule.type === 'EARN_RULE' ? 'bg-emerald-50 text-emerald-600' : 'bg-purple-50 text-purple-600'}`}>
                                        {rule.type.replace('_', ' ')}
                                    </div>

                                    <div className="mb-6">
                                        <div className="w-14 h-14 bg-slate-50 rounded-2xl flex items-center justify-center mb-4 text-slate-400 group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                                            {rule.reward_type === 'POINTS' ? <Award className="w-7 h-7" /> : <DollarSign className="w-7 h-7" />}
                                        </div>
                                        <h3 className="text-xl font-black text-slate-800 font-display leading-tight">{rule.name}</h3>
                                        {/* Branch Badge */}
                                        {userRole === UserRole.MAIN_ADMIN && !rule.branch_id && <span className="inline-block mt-2 px-2 py-1 bg-slate-100 rounded text-[9px] font-bold text-slate-500 uppercase">Global Rule</span>}
                                        {userRole === UserRole.MAIN_ADMIN && rule.branch_id && <span className="inline-block mt-2 px-2 py-1 bg-blue-50 rounded text-[9px] font-bold text-blue-500 uppercase">Branch Specific</span>}
                                    </div>

                                    <div className="bg-slate-50 rounded-2xl p-4 space-y-2 mb-6">
                                        <div className="flex justify-between items-center text-xs">
                                            <span className="font-bold text-slate-400 uppercase">Condition</span>
                                            <span className="font-black text-slate-700">
                                                {rule.condition_type === 'SPEND_AMOUNT' ? `Spend $${rule.condition_value}` : `${rule.condition_value} Orders`}
                                            </span>
                                        </div>
                                        <div className="flex justify-between items-center text-xs">
                                            <span className="font-black text-primary">
                                                {rule.reward_type === 'POINTS' ? `+${rule.reward_value} PTS` :
                                                    rule.reward_type === 'DISCOUNT_PERCENT' ? `${rule.reward_value}% OFF` : `$${rule.reward_value} OFF`}
                                            </span>
                                        </div>
                                        {rule.start_date && (
                                            <div className="flex justify-between items-center text-xs pt-1 border-t border-slate-100/50 mt-1">
                                                <span className="font-bold text-slate-400 uppercase">Valid Until</span>
                                                <span className="font-bold text-slate-600">
                                                    {new Date(rule.end_date || '').toLocaleDateString()}
                                                </span>
                                            </div>
                                        )}
                                    </div>

                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => { setRuleForm(rule); setEditingRuleId(rule.id); setView('EDIT'); }}
                                            className="flex-1 py-3 rounded-xl bg-slate-50 text-slate-600 font-bold text-xs uppercase tracking-wider hover:bg-slate-100 transition-colors"
                                        >
                                            Edit
                                        </button>
                                        <button
                                            onClick={() => handleDeleteRule(rule.id)}
                                            className="px-4 py-3 rounded-xl bg-red-50 text-red-500 font-bold text-xs hover:bg-red-100 transition-colors"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </>
            )}

            {/* CUSTOMERS TAB */}
            {activeTab === 'CUSTOMERS' && (
                <div className="bg-white rounded-[2.5rem] shadow-sm border border-slate-100 overflow-hidden">
                    <div className="p-8 border-b border-slate-50 flex flex-col md:flex-row justify-between items-center gap-4">
                        <h3 className="text-lg font-black text-slate-800 uppercase tracking-tight flex items-center gap-3">
                            <Users className="w-5 h-5 text-primary" />
                            Loyalty Database
                        </h3>

                        <div className="flex gap-2">
                            {['ALL', 'NEW', 'VIP', 'INACTIVE'].map(filter => (
                                <button
                                    key={filter}
                                    onClick={() => setCustomerFilter(filter as any)}
                                    className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${customerFilter === filter ? 'bg-slate-800 text-white' : 'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}
                                >
                                    {filter}
                                </button>
                            ))}
                        </div>

                        <div className="relative">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                            <input
                                type="text"
                                placeholder="Search customers..."
                                className="pl-10 pr-4 py-2 bg-slate-50 rounded-xl text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-primary/20"
                                value={customerSearch}
                                onChange={e => setCustomerSearch(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="bg-slate-50/50">
                                <tr>
                                    <th className="p-6 text-[10px] font-black text-slate-400 uppercase tracking-widest text-left">Customer</th>
                                    <th className="p-6 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Tier Status</th>
                                    <th className="p-6 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Current Points</th>
                                    <th className="p-6 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Lifetime Earned</th>
                                    <th className="p-6 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Total Spent</th>
                                </tr>
                            </thead>
                            <tbody>
                                {customerLoading ? (
                                    <tr><td colSpan={5} className="p-10 text-center text-slate-400 font-bold animate-pulse">Loading loyalty data...</td></tr>
                                ) : customers.length === 0 ? (
                                    <tr><td colSpan={5} className="p-10 text-center text-slate-400 font-bold">No customer data found</td></tr>
                                ) : (
                                    customers
                                        .filter(c => c.name?.toLowerCase().includes(customerSearch.toLowerCase()))
                                        .map(cust => (
                                            <tr key={cust.id} className="border-t border-slate-50 hover:bg-slate-50/30 transition-colors">
                                                <td className="p-6">
                                                    <div className="flex items-center gap-4">
                                                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center text-slate-500 font-black">
                                                            {cust.name?.charAt(0) || 'U'}
                                                        </div>
                                                        <div>
                                                            <div className="font-bold text-slate-800 text-sm">{cust.name || 'Unknown User'}</div>
                                                            <div className="text-[10px] font-bold text-slate-400">{cust.phone || 'No Phone'}</div>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="p-6 text-center">
                                                    <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest
                                                    ${cust.loyalty_tier === 'Gold' ? 'bg-amber-100 text-amber-700' :
                                                            cust.loyalty_tier === 'Silver' ? 'bg-slate-200 text-slate-600' : 'bg-orange-50 text-orange-600'}`}>
                                                        {cust.loyalty_tier || 'Bronze'}
                                                    </span>
                                                </td>
                                                <td className="p-6 text-center">
                                                    <span className="text-lg font-black text-primary">{cust.loyalty_points || 0}</span>
                                                </td>
                                                <td className="p-6 text-center">
                                                    <span className="text-sm font-bold text-slate-500">{cust.lifetime_points_earned || 0}</span>
                                                </td>
                                                <td className="p-6 text-center">
                                                    <span className="text-sm font-black text-slate-800">${cust.total_spent || 0}</span>
                                                </td>
                                            </tr>
                                        ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
};

export default LoyaltyManager;
