import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Branch } from '../types';
import { Plus, Tag, Calendar, Users, Percent, DollarSign, Trash2, Edit, X, Save, AlertTriangle, MessageCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import axios from 'axios';

export interface Discount {
    id: string;
    branch_id: string;
    name: string;
    description: string;
    type: 'PERCENTAGE' | 'FIXED_AMOUNT';
    value: number;
    start_date: string;
    end_date: string;
    target_audience: string;
    is_active: boolean;
    usage_limit_total?: number;
    current_usage_count: number;
    coupon_code?: string;
}

interface DiscountManagerProps {
    branches: Branch[];
}

const DiscountManager: React.FC<DiscountManagerProps> = ({ branches }) => {
    const { userRole, loggedInBranchId } = useAuth();
    const [discounts, setDiscounts] = useState<Discount[]>([]);
    const [loading, setLoading] = useState(true);
    const [isCreating, setIsCreating] = useState(false);
    const [step, setStep] = useState(1);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [selectedItems, setSelectedItems] = useState<string[]>([]); // item keys
    const [selectionMode, setSelectionMode] = useState<'FULL' | 'SPECIFIC'>('FULL');
    const [selectedUser, setSelectedUser] = useState<any | null>(null);
    const [userSearchQuery, setUserSearchQuery] = useState('');
    const [allCustomers, setAllCustomers] = useState<any[]>([]);

    // Form State
    const [formData, setFormData] = useState<Partial<Discount>>({
        type: 'PERCENTAGE',
        target_audience: 'ALL_USERS',
        is_active: true,
        branch_id: loggedInBranchId || branches[0]?.id || '',
        start_date: new Date().toISOString().split('T')[0],
        end_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    });

    const [sendNotification, setSendNotification] = useState(false);
    const [notificationChannel, setNotificationChannel] = useState<'VOICE' | 'WHATSAPP' | 'SMS'>('WHATSAPP');
    const [notificationMessage, setNotificationMessage] = useState('');

    const selectedBranch = branches.find(b => b.id === formData.branch_id) || branches[0];

    const fetchDiscounts = async () => {
        setLoading(true);
        let query = supabase.from('discounts').select('*').order('created_at', { ascending: false });
        if (loggedInBranchId) {
            query = query.eq('branch_id', loggedInBranchId);
        }
        const { data, error } = await query;
        if (error) console.error('Error fetching discounts:', error);
        else setDiscounts(data || []);
        setLoading(false);
    };

    const fetchPlayers = async (query = '') => {
        let q = supabase.from('profiles').select('*');
        if (query) {
            q = q.or(`name.ilike.%${query}%,phone.ilike.%${query}%`);
        }
        const { data } = await q.limit(20);
        setAllCustomers(data || []);
    };

    useEffect(() => {
        fetchDiscounts();
        fetchPlayers();
    }, [loggedInBranchId]);

    useEffect(() => {
        const timer = setTimeout(() => {
            fetchPlayers(userSearchQuery);
        }, 300);
        return () => clearTimeout(timer);
    }, [userSearchQuery]);

    useEffect(() => {
        if (!formData.branch_id && branches.length > 0) {
            setFormData(prev => ({ ...prev, branch_id: loggedInBranchId || branches[0].id }));
        }
    }, [branches, loggedInBranchId, formData.branch_id]);

    const handleSubmit = async () => {
        const missing = [];
        if (!formData.name) missing.push("Campaign Name");
        if (formData.value === undefined || formData.value === null) missing.push("Discount Value");
        if (!formData.start_date) missing.push("Start Date");
        if (!formData.end_date) missing.push("End Date");
        if (!formData.branch_id) missing.push("Target Branch");

        if (missing.length > 0) {
            alert(`Please fill the following required fields: ${missing.join(', ')}`);
            return;
        }

        const payload = {
            ...formData,
            description: selectionMode === 'SPECIFIC' ? `Items: ${selectedItems.join(', ')}` : 'All Menu Items',
            target_audience: selectedUser ? `USER:${selectedUser.id}` : formData.target_audience,
            // Add notification metadata to the discount (optional, for tracking)
            notification_sent: sendNotification,
            notification_channel: sendNotification ? notificationChannel : null
        };

        if (editingId) {
            const { error } = await supabase.from('discounts').update(payload).eq('id', editingId);
            if (error) alert(error.message);
        } else {
            const { error } = await supabase.from('discounts').insert(payload);
            if (error) alert(error.message);
        }

        // If notification enabled, trigger the background process
        if (sendNotification) {
            try {
                await axios.post('/api/send-campaign', {
                    audience: payload.target_audience,
                    message: notificationMessage,
                    type: notificationChannel,
                    branchId: payload.branch_id,
                    campaignName: payload.name
                });
                console.log(`✅ Campaign notification queued via ${notificationChannel}`);
            } catch (err) {
                console.error('❌ Failed to send campaign notification:', err);
            }
        }

        setIsCreating(false);
        setStep(1);
        setEditingId(null);
        setSelectedItems([]);
        setSelectedUser(null);
        setFormData({ type: 'PERCENTAGE', target_audience: 'ALL_USERS', is_active: true, branch_id: loggedInBranchId || branches[0]?.id || '' });
        fetchDiscounts();
    };

    const handleDelete = async (id: string) => {
        if (!window.confirm("Delete this offer?")) return;
        await supabase.from('discounts').delete().eq('id', id);
        fetchDiscounts();
    };

    const handleEdit = (discount: Discount) => {
        setFormData(discount);
        setEditingId(discount.id);
        setIsCreating(true);
        setStep(1);
    };

    if (isCreating) {
        return (
            <div className="space-y-8 animate-fade-in-up pb-10">
                {/* Header with Back Button */}
                <div className="flex justify-between items-center bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-100">
                    <div className="flex items-center gap-5">
                        <button
                            onClick={() => { setIsCreating(false); setStep(1); }}
                            className="p-3 bg-slate-50 text-slate-400 hover:text-primary hover:bg-blue-50 rounded-full transition-all"
                        >
                            <X className="w-6 h-6" />
                        </button>
                        <div>
                            <h2 className="text-2xl font-extrabold text-slate-800 font-display">
                                {editingId ? 'Edit Promotional Campaign' : 'Create New Campaign'}
                            </h2>
                            <div className="flex items-center gap-2 mt-1">
                                <span className={`w-8 h-1 rounded-full ${step >= 1 ? 'bg-primary' : 'bg-slate-200'}`}></span>
                                <span className={`w-8 h-1 rounded-full ${step >= 2 ? 'bg-primary' : 'bg-slate-200'}`}></span>
                                <span className={`w-8 h-1 rounded-full ${step >= 3 ? 'bg-primary' : 'bg-slate-200'}`}></span>
                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Phase {step} of 3</span>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        {step > 1 && (
                            <button onClick={() => setStep(step - 1)} className="px-6 py-3 bg-white text-slate-600 border border-slate-200 rounded-2xl font-bold text-sm hover:bg-slate-50 transition-all">
                                Back
                            </button>
                        )}
                        <button
                            onClick={() => {
                                if (step === 1 && (!formData.name || !formData.branch_id || formData.value === undefined)) {
                                    alert("Phase 1 incomplete: Please ensure Campaign Name, Value, and Target Branch are filled.");
                                    return;
                                }
                                if (step === 2) {
                                    setStep(3);
                                    // Auto-generate a descriptive message
                                    const discountText = formData.type === 'PERCENTAGE' ? `${formData.value}% OFF` : `SAR ${formData.value} Discount`;
                                    const couponPart = formData.coupon_code ? ` Use code: ${formData.coupon_code}` : ` Use code: ${formData.name}`;
                                    setNotificationMessage(`Hello! Get ${discountText} on our menu today!${couponPart}. Valid for your account only.`);
                                    return;
                                }
                                if (step === 3) {
                                    handleSubmit();
                                    return;
                                }
                                setStep(step + 1);
                            }}
                            className={`px-8 py-3.5 bg-primary text-white rounded-2xl shadow-lg shadow-primary/25 font-black text-sm uppercase tracking-wider hover:bg-sky-600 transition-all ${step === 1 && (!formData.name || !formData.branch_id) ? 'opacity-80' : ''}`}
                        >
                            {step === 1 ? 'Next: Define Audience' : step === 2 ? 'Next: Notifications' : (editingId ? 'Update & Finish' : 'Launch Campaign')}
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Main Configuration Area */}
                    <div className="lg:col-span-2 space-y-8">
                        {step === 1 ? (
                            <div className="bg-white rounded-[2.5rem] shadow-sm border border-slate-100 overflow-hidden">
                                <div className="p-8 border-b border-slate-50">
                                    <h3 className="text-lg font-black text-slate-800 uppercase tracking-tight flex items-center gap-3">
                                        <Tag className="w-5 h-5 text-primary" />
                                        1. Offer Configuration & Menu
                                    </h3>
                                </div>
                                <div className="p-8 space-y-8">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        {!loggedInBranchId && (
                                            <div className="space-y-2">
                                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Target Branch</label>
                                                <select
                                                    className="w-full p-4 bg-slate-50 rounded-2xl border border-slate-200 font-bold focus:ring-4 focus:ring-primary/10 transition-all outline-none"
                                                    value={formData.branch_id}
                                                    onChange={e => { setFormData({ ...formData, branch_id: e.target.value }); setSelectedItems([]); }}
                                                >
                                                    <option value="" disabled>Select a branch...</option>
                                                    {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                                                </select>
                                                {!formData.branch_id && <p className="text-[9px] text-red-500 font-bold mt-1 ml-1">Error: No branch selected for this campaign</p>}
                                            </div>
                                        )}
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Campaign Name</label>
                                            <input
                                                type="text"
                                                placeholder="e.g. Weekend Delight 2026"
                                                className="w-full p-4 bg-slate-50 rounded-2xl border border-slate-200 font-bold focus:ring-4 focus:ring-primary/10 transition-all outline-none"
                                                value={formData.name || ''}
                                                onChange={e => setFormData({ ...formData, name: e.target.value })}
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Coupon Code (Unique)</label>
                                            <div className="relative">
                                                <input
                                                    type="text"
                                                    placeholder="e.g. SAVE99"
                                                    className="w-full p-4 bg-slate-50 rounded-2xl border border-slate-200 font-bold focus:ring-4 focus:ring-primary/10 transition-all outline-none uppercase placeholder:lowercase"
                                                    value={formData.coupon_code || ''}
                                                    onChange={e => setFormData({ ...formData, coupon_code: e.target.value.toUpperCase() })}
                                                />
                                                <div className="absolute right-4 top-1/2 -translate-y-1/2">
                                                    <Tag className="w-4 h-4 text-slate-300" />
                                                </div>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-2">
                                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Value</label>
                                                <div className="relative">
                                                    <input
                                                        type="number"
                                                        className="w-full p-4 bg-slate-50 rounded-2xl border border-slate-200 font-bold focus:ring-4 focus:ring-primary/10 transition-all outline-none pl-10"
                                                        value={formData.value || 0}
                                                        onChange={e => setFormData({ ...formData, value: parseFloat(e.target.value) })}
                                                    />
                                                    {formData.type === 'PERCENTAGE' ? <Percent className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" /> : <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />}
                                                </div>
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Type</label>
                                                <select
                                                    className="w-full p-4 bg-slate-50 rounded-2xl border border-slate-200 font-bold focus:ring-4 focus:ring-primary/10 transition-all outline-none appearance-none"
                                                    value={formData.type}
                                                    onChange={(e: any) => setFormData({ ...formData, type: e.target.value })}
                                                >
                                                    <option value="PERCENTAGE">Percent (%)</option>
                                                    <option value="FIXED_AMOUNT">Fixed (SAR)</option>
                                                </select>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Menu Selection */}
                                    <div className="space-y-4">
                                        <div className="flex justify-between items-end">
                                            <div>
                                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Menu Items Selection</label>
                                                <p className="text-xs text-slate-500 font-bold mt-1">Pick specific dishes or apply to whole menu</p>
                                            </div>
                                            <div className="flex bg-slate-100 p-1 rounded-xl">
                                                <button
                                                    onClick={() => setSelectionMode('FULL')}
                                                    className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${selectionMode === 'FULL' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                                                >
                                                    Full Menu
                                                </button>
                                                <button
                                                    onClick={() => { setSelectionMode('SPECIFIC'); if (selectedItems.length === 0 && selectedBranch?.menu[0]) setSelectedItems([selectedBranch.menu[0].key]); }}
                                                    className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${selectionMode === 'SPECIFIC' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                                                >
                                                    Specific Items
                                                </button>
                                            </div>
                                        </div>

                                        {selectedBranch && (
                                            <div className="bg-slate-50 rounded-3xl p-6 border border-slate-100 grid grid-cols-2 md:grid-cols-3 gap-4 max-h-[400px] overflow-y-auto custom-scrollbar relative">
                                                {selectionMode === 'FULL' && (
                                                    <div className="absolute inset-0 bg-white/40 backdrop-blur-[1px] z-10 flex items-center justify-center pointer-events-none">
                                                        <div className="bg-white/90 px-6 py-2 rounded-full border border-slate-200 shadow-sm animate-pop">
                                                            <span className="text-[10px] font-black text-slate-700 uppercase tracking-widest">Apply to All Menu Items</span>
                                                        </div>
                                                    </div>
                                                )}
                                                {selectedBranch.menu.map(item => {
                                                    const isSelected = selectionMode === 'FULL' || selectedItems.includes(item.key);
                                                    const discountAmount = formData.value || 0;
                                                    const newPrice = formData.type === 'PERCENTAGE'
                                                        ? item.price * (1 - discountAmount / 100)
                                                        : Math.max(0, item.price - discountAmount);

                                                    return (
                                                        <button
                                                            key={item.key}
                                                            onClick={() => {
                                                                if (selectionMode === 'FULL') setSelectionMode('SPECIFIC');
                                                                setSelectedItems(prev => prev.includes(item.key) ? prev.filter(k => k !== item.key) : [...prev, item.key]);
                                                            }}
                                                            className={`flex flex-col p-4 rounded-2xl border-2 transition-all text-left relative ${isSelected ? 'bg-primary/5 border-primary shadow-md' : 'bg-white border-white hover:border-slate-200'}`}
                                                        >
                                                            <div className="flex justify-between items-start mb-1">
                                                                <div className="flex flex-col">
                                                                    <span className="text-xs font-black text-slate-800 leading-tight">{item.name_en}</span>
                                                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{item.category}</span>
                                                                </div>
                                                                {isSelected && discountAmount > 0 && (
                                                                    <div className="bg-red-500 text-white text-[9px] font-black px-1.5 py-0.5 rounded-md animate-pop">
                                                                        {formData.type === 'PERCENTAGE' ? `-${discountAmount}%` : `-${discountAmount} SAR`}
                                                                    </div>
                                                                )}
                                                            </div>
                                                            <div className="flex items-center gap-2 mt-auto pt-2">
                                                                {isSelected && discountAmount > 0 && (
                                                                    <span className="text-[10px] font-bold text-slate-300 line-through decoration-slate-400/50 decoration-2">SAR {item.price}</span>
                                                                )}
                                                                <span className={`text-xs font-black ${isSelected && discountAmount > 0 ? 'text-primary' : 'text-slate-600'}`}>
                                                                    SAR {isSelected && discountAmount > 0 ? newPrice.toFixed(2) : item.price}
                                                                </span>
                                                            </div>
                                                            {isSelected && (
                                                                <div className="absolute -top-1.5 -right-1.5 w-6 h-6 bg-primary text-white rounded-full flex items-center justify-center shadow-md animate-pop z-20">
                                                                    <Tag className="w-3.5 h-3.5" />
                                                                </div>
                                                            )}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ) : step === 2 ? (
                            <div className="bg-white rounded-[2.5rem] shadow-sm border border-slate-100 overflow-hidden">
                                <div className="p-8 border-b border-slate-50">
                                    <h3 className="text-lg font-black text-slate-800 uppercase tracking-tight flex items-center gap-3">
                                        <Users className="w-5 h-5 text-primary" />
                                        2. Targeting & Audience
                                    </h3>
                                </div>
                                <div className="p-8 space-y-8">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                        <div className="space-y-6">
                                            <div className="space-y-3">
                                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">General Audience</label>
                                                {[
                                                    { id: 'ALL_USERS', label: 'All Registered Members', desc: 'Sends to every customer in the database' },
                                                    { id: 'NEW_USERS', label: 'New Members Only', desc: 'Joined within the last 7 days' },
                                                    { id: 'INACTIVE_30_DAYS', label: 'Re-engagement (30d Inactive)', desc: 'Users who haven\'t ordered in 30+ days' },
                                                    { id: 'CUSTOM_AUDIENCE', label: 'Custom Filters', desc: 'Targeting specific inactive groups' }
                                                ].map(opt => (
                                                    <button
                                                        key={opt.id}
                                                        onClick={() => { setFormData({ ...formData, target_audience: opt.id }); setSelectedUser(null); }}
                                                        className={`w-full p-4 rounded-2xl border-2 transition-all text-left flex items-start gap-4 ${formData.target_audience === opt.id && !selectedUser ? 'bg-primary/5 border-primary shadow-sm' : 'bg-slate-50 border-slate-50 hover:border-slate-200'}`}
                                                    >
                                                        <div className={`mt-1 w-4 h-4 rounded-full border-2 flex items-center justify-center ${formData.target_audience === opt.id && !selectedUser ? 'border-primary' : 'border-slate-300'}`}>
                                                            {formData.target_audience === opt.id && !selectedUser && <div className="w-2 h-2 bg-primary rounded-full"></div>}
                                                        </div>
                                                        <div>
                                                            <div className="text-sm font-black text-slate-800">{opt.label}</div>
                                                            <div className="text-[10px] text-slate-500 font-bold mt-0.5">{opt.desc}</div>
                                                        </div>
                                                    </button>
                                                ))}
                                            </div>

                                            {(formData.target_audience === 'CUSTOM_AUDIENCE' || formData.target_audience?.startsWith('INACTIVE_')) && (
                                                <div className="space-y-3 p-6 bg-slate-50 rounded-[2rem] animate-pop">
                                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Inactivity Period</label>
                                                    <div className="grid grid-cols-2 gap-2">
                                                        {['5', '10', '20', '30', '45', '60', '90'].map(days => (
                                                            <button
                                                                key={days}
                                                                onClick={() => { setFormData({ ...formData, target_audience: `INACTIVE_${days}_DAYS` }); setSelectedUser(null); }}
                                                                className={`px-4 py-2 rounded-xl text-xs font-bold border transition-all ${formData.target_audience === `INACTIVE_${days}_DAYS` ? 'bg-white border-primary text-primary shadow-sm' : 'bg-white border-slate-200 text-slate-500'}`}
                                                            >
                                                                {days} Days+
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        <div className="space-y-6">
                                            <div className="space-y-3">
                                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Target Individual User</label>
                                                <div className="relative">
                                                    <input
                                                        type="text"
                                                        placeholder="Search by name or phone..."
                                                        className="w-full p-4 bg-slate-50 rounded-2xl border border-slate-200 font-bold outline-none focus:ring-4 focus:ring-primary/10 transition-all text-sm"
                                                        value={userSearchQuery}
                                                        onChange={e => setUserSearchQuery(e.target.value)}
                                                    />
                                                </div>

                                                {userSearchQuery && allCustomers.length > 0 && (
                                                    <div className="bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden animate-pop z-10 max-h-[250px] overflow-y-auto">
                                                        {allCustomers.map(user => (
                                                            <button
                                                                key={user.id}
                                                                onClick={() => { setSelectedUser(user); setUserSearchQuery(''); }}
                                                                className="w-full p-4 hover:bg-slate-50 flex items-center gap-4 text-left border-b border-slate-50 last:border-0"
                                                            >
                                                                <img src={user.avatar_url || `https://ui-avatars.com/api/?name=${user.name}`} className="w-10 h-10 rounded-full bg-slate-100" />
                                                                <div>
                                                                    <div className="text-sm font-black text-slate-800">{user.name}</div>
                                                                    <div className="text-[10px] text-slate-500 font-bold">{user.phone}</div>
                                                                </div>
                                                                {selectedUser?.id === user.id && <Tag className="w-4 h-4 text-primary ml-auto" />}
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}

                                                {selectedUser && (
                                                    <div className="flex items-center justify-between p-4 bg-emerald-50 border border-emerald-100 rounded-2xl animate-pop mt-4">
                                                        <div className="flex items-center gap-4">
                                                            <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center">
                                                                <Users className="w-5 h-5 text-emerald-600" />
                                                            </div>
                                                            <div>
                                                                <div className="text-sm font-black text-emerald-800">{selectedUser.name}</div>
                                                                <div className="text-[10px] text-emerald-600 font-bold">Priority Target Selected</div>
                                                            </div>
                                                        </div>
                                                        <button onClick={() => setSelectedUser(null)} className="p-2 text-emerald-400 hover:text-emerald-600">
                                                            <X className="w-4 h-4" />
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="bg-white rounded-[2.5rem] shadow-sm border border-slate-100 overflow-hidden animate-fade-in-up">
                                <div className="p-8 border-b border-slate-50 flex justify-between items-center">
                                    <h3 className="text-lg font-black text-slate-800 uppercase tracking-tight flex items-center gap-3">
                                        <MessageCircle className="w-5 h-5 text-primary" />
                                        3. Notification Strategy
                                    </h3>
                                    <button
                                        onClick={() => { setSendNotification(false); handleSubmit(); }}
                                        className="text-xs font-black text-slate-400 hover:text-slate-600 uppercase tracking-widest"
                                    >
                                        Skip & Finalize
                                    </button>
                                </div>
                                <div className="p-8 space-y-8">
                                    <div className="bg-slate-50 p-6 rounded-[2rem] flex items-center gap-6">
                                        <div className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${sendNotification ? 'bg-primary text-white shadow-lg' : 'bg-slate-200 text-slate-400'}`}>
                                            <Tag className="w-6 h-6" />
                                        </div>
                                        <div>
                                            <div className="text-sm font-black text-slate-800">Blast Notification?</div>
                                            <div className="text-[10px] text-slate-500 font-bold mt-1">Automatically alert {selectedUser ? "this user" : "your selected audience"} about this deal.</div>
                                        </div>
                                        <button
                                            onClick={() => setSendNotification(!sendNotification)}
                                            className={`ml-auto w-14 h-8 rounded-full relative transition-all ${sendNotification ? 'bg-primary' : 'bg-slate-300'}`}
                                        >
                                            <div className={`absolute top-1 w-6 h-6 bg-white rounded-full transition-all ${sendNotification ? 'right-1' : 'left-1 shadow-sm'}`}></div>
                                        </button>
                                    </div>

                                    {sendNotification && (
                                        <div className="space-y-6 animate-pop">
                                            <div className="bg-primary/5 p-6 rounded-2xl border-2 border-primary/20 flex items-center gap-4 animate-pop">
                                                <div className="w-12 h-12 bg-primary text-white rounded-xl flex items-center justify-center text-2xl shadow-lg">
                                                    📱
                                                </div>
                                                <div>
                                                    <div className="text-sm font-black text-slate-800 uppercase tracking-tight">WhatsApp Channel</div>
                                                    <div className="text-[10px] text-primary font-bold">Standard automated broadcast enabled</div>
                                                </div>
                                            </div>

                                            <div className="space-y-2">
                                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Message Content</label>
                                                <textarea
                                                    className="w-full p-4 bg-slate-50 rounded-2xl border border-slate-200 font-bold focus:ring-4 focus:ring-primary/10 transition-all outline-none h-32 resize-none"
                                                    value={notificationMessage}
                                                    onChange={e => setNotificationMessage(e.target.value)}
                                                    placeholder="Hey! Don't miss out on this amazing deal..."
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Summary Sidebar */}
                    <div className="space-y-6">
                        <div className="bg-slate-900 rounded-[2.5rem] p-8 text-white shadow-2xl relative overflow-hidden ring-4 ring-white shadow-slate-200">
                            <div className="absolute top-0 right-0 w-32 h-32 bg-primary/20 rounded-full -mr-16 -mt-16 blur-3xl"></div>
                            <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-6">Campaign Preview</h4>

                            <div className="space-y-6 relative z-10">
                                <div>
                                    <div className="text-3xl font-black font-display text-white">
                                        {formData.value || 0}{formData.type === 'PERCENTAGE' ? '%' : ' SAR'}
                                        <span className="text-xs text-primary ml-2 uppercase font-black">Limited Offer</span>
                                    </div>
                                    <div className="text-xs font-bold text-slate-400 mt-1 uppercase tracking-wider">{formData.name || 'Untitled Campaign'}</div>
                                </div>

                                <div className="p-5 bg-white/5 rounded-2xl border border-white/10 space-y-3">
                                    <div className="flex items-center justify-between">
                                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-tight">Scope</span>
                                        <span className="text-[11px] font-black text-white">{selectionMode === 'FULL' ? 'Full Menu' : `${selectedItems.length} Specific Items`}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-tight">Audience</span>
                                        <span className="text-[11px] font-black text-white">{selectedUser ? selectedUser.name : formData.target_audience?.replace('_', ' ')}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-tight">Ends On</span>
                                        <span className="text-[11px] font-black text-white">{formData.end_date ? new Date(formData.end_date).toLocaleDateString() : 'N/A'}</span>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Campaign Visual</div>
                                    <div className="h-24 bg-gradient-to-br from-primary/20 to-blue-600/20 rounded-2xl border border-white/10 flex items-center justify-center text-center p-4 italic text-xs text-slate-300">
                                        "Get {formData.value}{formData.type === 'PERCENTAGE' ? '%' : ' SAR'} OFF on {selectedItems.length === 0 ? 'all items' : 'selected favorites'}!"
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="bg-amber-50 border border-amber-100 p-6 rounded-[2rem] flex items-start gap-4">
                            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                            <div>
                                <h5 className="text-sm font-black text-amber-800 uppercase tracking-tight">System Notice</h5>
                                <p className="text-xs text-amber-700 font-medium mt-1 leading-relaxed">
                                    Campaigns are automatically broadcasted to the selected audience via WhatsApp Bot upon activation.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-fade-in-up pb-10">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-100">
                <div>
                    <h2 className="text-3xl font-extrabold text-slate-800 font-display">Discounts & Offers</h2>
                    <p className="text-slate-500 font-medium mt-1">Manage promotional campaigns & targeting</p>
                </div>
                <button
                    onClick={() => {
                        setEditingId(null);
                        setIsCreating(true);
                        setStep(1);
                        setFormData({
                            type: 'PERCENTAGE',
                            target_audience: 'ALL_USERS',
                            is_active: true,
                            branch_id: loggedInBranchId || branches[0]?.id || '',
                            start_date: new Date().toISOString().split('T')[0],
                            end_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
                        });
                        setSelectedItems([]);
                        setSelectedUser(null);
                        setSelectionMode('FULL');
                    }}
                    className="flex items-center gap-2 px-6 py-3.5 bg-primary text-white rounded-2xl hover:bg-sky-600 transition-all shadow-lg shadow-primary/30 font-bold text-sm uppercase tracking-wider"
                >
                    <Plus className="w-5 h-5" />
                    <span>Create Campaign</span>
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {discounts.map(discount => (
                    <div key={discount.id} className="bg-white p-6 rounded-[2.5rem] border border-slate-100 shadow-sm relative group hover:shadow-xl hover:scale-[1.02] transition-all">
                        <div className="flex justify-between items-start mb-4">
                            <span className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest ${discount.is_active ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
                                {discount.is_active ? 'Active' : 'Expired'}
                            </span>
                            <div className="flex gap-2">
                                <button onClick={() => handleEdit(discount)} className="p-2 hover:bg-slate-50 rounded-full text-slate-300 hover:text-primary transition-colors"><Edit className="w-4 h-4" /></button>
                                <button onClick={() => handleDelete(discount.id)} className="p-2 hover:bg-red-50 rounded-full text-slate-300 hover:text-red-500 transition-colors"><Trash2 className="w-4 h-4" /></button>
                            </div>
                        </div>

                        <h3 className="text-xl font-extrabold text-slate-800 font-display mb-1 truncate pr-16">{discount.name}</h3>
                        {discount.coupon_code && (
                            <div className="flex items-center gap-2 mb-3">
                                <span className="px-2 py-0.5 bg-primary/10 text-primary text-[10px] font-black rounded border border-primary/20 uppercase tracking-tighter">Coupon</span>
                                <span className="text-xs font-mono font-black text-slate-600">{discount.coupon_code}</span>
                            </div>
                        )}

                        <div className="text-4xl font-black text-primary font-display mb-4 flex items-baseline gap-1">
                            {discount.type === 'PERCENTAGE' ? `${discount.value}%` : `SAR ${discount.value}`}
                            <span className="text-sm text-slate-400 font-medium uppercase tracking-widest ml-1">OFF</span>
                        </div>

                        <div className="grid grid-cols-2 gap-3 pt-4 border-t border-slate-50">
                            <div className="space-y-1">
                                <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest block ml-1">Audience</span>
                                <div className="flex items-center gap-2 text-[10px] text-slate-600 font-bold">
                                    <Users className="w-3 h-3 text-slate-400" />
                                    <span className="truncate">{discount.target_audience.startsWith('USER:') ? 'Personal' : discount.target_audience.replace(/_/g, ' ')}</span>
                                </div>
                            </div>
                            <div className="space-y-1">
                                <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest block ml-1">Usage</span>
                                <div className="flex items-center gap-2 text-[10px] text-emerald-600 font-black">
                                    <Plus className="w-3 h-3 rotate-45" />
                                    <span>{discount.current_usage_count || 0} {discount.usage_limit_total ? `/ ${discount.usage_limit_total}` : 'Used'}</span>
                                </div>
                            </div>
                        </div>

                        <div className="mt-4 pt-3 flex items-center gap-3 text-[10px] text-slate-400 font-bold border-t border-slate-50 group-hover:text-slate-500 transition-colors">
                            <Calendar className="w-3.5 h-3.5" />
                            <span>{new Date(discount.start_date).toLocaleDateString()} - {new Date(discount.end_date).toLocaleDateString()}</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default DiscountManager;
