import React, { useState, useMemo, useCallback } from 'react';
import { usePublicMenu, type PublicMenuItem } from './hooks/usePublicMenu';
import BranchHero from './components/BranchHero';
import CategoryBar from './components/CategoryBar';
import MenuCard from './components/MenuCard';
import CartSidebar, { type CartItem } from './components/CartSidebar';
import ProductModal from './components/ProductModal';
import CheckoutModal from './components/CheckoutModal'; // NEW
import OrderTracker from './components/OrderTracker'; // NEW
import LandingPage from './components/LandingPage'; // NEW
import ReviewSidebar from './components/ReviewSidebar';
import { useOrder } from './hooks/useOrder'; // NEW
import { useLoyalty } from './hooks/useLoyalty'; // NEW
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import { Search, UtensilsCrossed, ShoppingBag, History, Star } from 'lucide-react'; // Added Star icon
import { supabase } from './lib/supabase';

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1
    }
  }
};
// ... (omitting unchanged itemVariants) ...
const itemVariants: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      type: "spring",
      stiffness: 100,
      damping: 15
    }
  }
};

const App: React.FC = () => {
  // Support dynamic branch selection via URL (e.g., ?branch_id=123)
  const searchParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const branchIdParam = searchParams.get('branch_id');

  // Auto-Registration Logic for WhatsApp Users
  React.useEffect(() => {
    const waPhone = searchParams.get('wa_phone');
    const waName = searchParams.get('wa_name');

    if (waPhone && waName) {
      const registerUser = async () => {
        const phoneStr = waPhone.replace(/\s+/g, '').replace('+', '');

        try {
          // 1. Ensure Profile exists
          const { data: profile } = await supabase
            .from('profiles')
            .upsert({
              phone: phoneStr,
              name: waName,
              role: 'customer'
            }, { onConflict: 'phone' })
            .select()
            .single();

          if (profile) {
            // 2. Ensure Customer record exists
            const { data: existingCustomer } = await supabase
              .from('customers')
              .select('id')
              .eq('phone', phoneStr)
              .maybeSingle();

            if (!existingCustomer) {
              await supabase.from('customers').insert({
                id: profile.id,
                name: waName,
                phone: phoneStr,
                email: `wa-${phoneStr}@foodboot.com`,
                total_orders: 0,
                total_spent: 0,
                join_date: new Date().toISOString().split('T')[0]
              });
              console.log('✅ Auto-registered WhatsApp user:', waName);
            }
          }
        } catch (err) {
          console.error('❌ Auto-registration failed:', err);
        }
      };
      registerUser();
    }
  }, [searchParams]);

  const { branch, categories, items, reviewStats, loading } = usePublicMenu(branchIdParam || undefined);
  const { calculatePotentialPoints, getCustomerPoints, calculateApplicableDiscounts, activeDeals, loading: loyaltyLoading } = useLoyalty(branch?.id);


  const [activeCategoryId, setActiveCategoryId] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const total = useMemo(() => {
    const subtotal = cart.reduce((sum, i) => sum + (i.discounted_price || i.price) * i.quantity, 0);
    return subtotal > 0 ? subtotal + 15 : 0; // 15 SAR delivery fee
  }, [cart]);
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const [isCheckoutOpen, setCheckoutOpen] = useState(false); // NEW
  const [isTrackerOpen, setTrackerOpen] = useState(false); // NEW
  const [isReviewsOpen, setReviewsOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<PublicMenuItem | null>(null);

  const { submitOrder } = useOrder(); // NEW

  // -- Cart Actions --
  const addToCart = useCallback((item: PublicMenuItem) => {
    setCart(prev => {
      const existing = prev.find(i => i.id === item.id);
      if (existing) {
        return prev.map(i => i.id === item.id ? { ...i, quantity: i.quantity + 1 } : i);
      }
      return [...prev, { ...item, quantity: 1 }];
    });
    setSidebarOpen(true); // Auto-open sidebar on add
  }, []);

  const updateQuantity = useCallback((itemId: string, delta: number) => {
    setCart(prev => prev.map(item => {
      if (item.id === itemId) {
        const newQty = Math.max(0, item.quantity + delta);
        return { ...item, quantity: newQty };
      }
      return item;
    }).filter(item => item.quantity > 0));
  }, []);

  const removeFromCart = useCallback((itemId: string) => {
    setCart(prev => prev.filter(item => item.id !== itemId));
  }, []);

  /* Filter Logic */
  const validCategories = useMemo(() => {
    return categories.filter(cat =>
      items.some(item => item.category_id === cat.id)
    );
  }, [categories, items]);

  // Group items logic
  const renderContent = useMemo(() => {
    if (searchQuery) {
      const filtered = items.filter(item =>
        item.name_en.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.name_ar.includes(searchQuery)
      );

      return (
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="grid grid-cols-1 xl:grid-cols-2 gap-6"
        >
          {filtered.map(item => (
            <motion.div key={item.id} variants={itemVariants}>
              <MenuCard item={item} onAdd={addToCart} onClick={() => setSelectedItem(item)} />
            </motion.div>
          ))}
        </motion.div>
      );
    }

    if (activeCategoryId === 'all') {
      return (
        <div className="space-y-16">
          {validCategories.map(cat => {
            const catItems = items.filter(item => item.category_id === cat.id);
            if (catItems.length === 0) return null;

            return (
              <motion.section
                key={cat.id}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-100px" }}
                transition={{ duration: 0.6 }}
              >
                <div className="flex items-center gap-4 mb-6 sticky top-20 z-30 py-4 -mx-4 px-4 bg-white/5 backdrop-blur-sm rounded-xl">
                  <div className="h-8 w-1 bg-primary rounded-full" />
                  <h3 className="text-2xl font-bold text-slate-800 font-display tracking-tight">
                    {cat.name_en}
                  </h3>
                  <span className="text-xs font-medium text-slate-400 bg-white/50 px-2 py-1 rounded-full border border-white/20">
                    {catItems.length} items
                  </span>
                </div>

                <motion.div
                  variants={containerVariants}
                  initial="hidden"
                  whileInView="visible"
                  viewport={{ once: true }}
                  className="grid grid-cols-1 xl:grid-cols-2 gap-6"
                >
                  {catItems.map(item => (
                    <motion.div key={item.id} variants={itemVariants}>
                      <MenuCard item={item} onAdd={addToCart} onClick={() => setSelectedItem(item)} />
                    </motion.div>
                  ))}
                </motion.div>
              </motion.section>
            );
          })}
        </div>
      );
    }

    const filtered = items.filter(item => item.category_id === activeCategoryId);
    return (
      <motion.div
        key={activeCategoryId}
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="grid grid-cols-1 xl:grid-cols-2 gap-6"
      >
        {filtered.map(item => (
          <motion.div key={item.id} variants={itemVariants}>
            <MenuCard item={item} onAdd={addToCart} onClick={() => setSelectedItem(item)} />
          </motion.div>
        ))}
      </motion.div>
    );

  }, [items, validCategories, activeCategoryId, searchQuery, addToCart]);

  // -- If no branch is selected via URL, show the Landing Page --
  if (!branchIdParam) {
    return <LandingPage />;
  }

  // -- Transition Loader: Show when entering a branch --
  if (branchIdParam && loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center relative overflow-hidden">
        <div className="bg-noise absolute inset-0 opacity-20 mix-blend-overlay" />
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/20 rounded-full blur-[120px] animate-pulse" />

        <div className="relative z-10 flex flex-col items-center gap-8">
          <div className="relative">
            <div className="w-20 h-20 border-4 border-slate-800 rounded-full" />
            <div className="absolute inset-0 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            <UtensilsCrossed className="absolute inset-0 m-auto w-8 h-8 text-white/50" />
          </div>
          <div className="text-center space-y-2">
            <h2 className="text-2xl font-bold text-white font-display tracking-tight">Entering Branch</h2>
            <div className="flex gap-1 justify-center">
              <span className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen mesh-bg selection:bg-primary/20 relative flex">
      {/* Elegance Polish: Noise Texture Overlay */}
      <div className="bg-noise fixed inset-0 z-40 pointer-events-none mix-blend-overlay" />

      {/* Main Content Area - Transitions width based on sidebar */}
      <div className={`flex-1 transition-all duration-500 ease-in-out ${isSidebarOpen ? 'mr-0 md:mr-[400px]' : ''}`}>

        {/* Header */}
        <header className="sticky top-4 z-50 mx-4 md:mx-6 rounded-2xl glass-panel px-6 py-4 flex items-center justify-between transition-all duration-300">
          <a href={window.location.pathname} className="flex items-center gap-3 hover:opacity-80 transition-opacity cursor-pointer">
            <div className="p-2.5 bg-primary/10 rounded-xl">
              <UtensilsCrossed className="w-6 h-6 text-primary" />
            </div>
            <span className="text-xl font-bold text-slate-800 tracking-tight font-display">FOOD BOOT</span>
          </a>

          <div className="flex-1 max-w-xl mx-8 relative group hidden md:block">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400/80 transition-colors group-focus-within:text-primary" />
            <input
              type="text"
              placeholder="Search for dishes..."
              className="w-full bg-slate-50/50 border border-transparent rounded-xl py-2.5 pl-12 pr-4 text-sm font-medium focus:outline-none focus:bg-white focus:shadow-premium transition-all placeholder:text-slate-400"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={() => setTrackerOpen(true)}
              className="p-2 rounded-xl bg-white/50 hover:bg-white text-slate-800 transition-all border border-transparent hover:border-slate-200 group relative"
              title="My Orders"
            >
              <History className="w-6 h-6 group-hover:text-primary transition-colors" />
              {/* Optional: Add red dot if active orders exist */}
            </button>
            <button
              onClick={() => setSidebarOpen(!isSidebarOpen)}
              className="p-2 rounded-xl bg-white/50 hover:bg-white text-slate-800 transition-all border border-transparent hover:border-slate-200 relative group"
            >
              <ShoppingBag className="w-6 h-6 group-hover:text-primary transition-colors" />
              {cart.length > 0 && (
                <span className="absolute -top-1 -right-1 w-5 h-5 bg-primary text-white text-[10px] font-black rounded-full flex items-center justify-center border-2 border-white animate-in zoom-in duration-300">
                  {cart.length}
                </span>
              )}
            </button>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-4 pb-32 pt-8 relative z-10 p-4">
          <BranchHero branch={branch} loading={loading} />

          {/* Deals Section (Dynamic) */}
          <section className="mt-8 mb-12">
            <div className="flex justify-between items-center mb-6 px-2">
              <h2 className="text-xl font-bold text-slate-800 tracking-tight font-display">Available rewards</h2>
              <button className="text-primary text-xs font-semibold hover:underline">View all</button>
            </div>

            {loyaltyLoading ? (
              <div className="flex gap-4 overflow-x-auto pb-4 px-4 bg-white/40 rounded-xl animate-pulse h-32 items-center justify-center text-slate-400 font-medium text-xs">
                Loading Offers...
              </div>
            ) : activeDeals.length === 0 ? (
              <div className="text-center py-8 bg-white/40 rounded-[2rem] border border-dashed border-slate-200">
                <p className="text-slate-400 text-sm font-medium">No active rewards at the moment.</p>
              </div>
            ) : (
              <div className="flex gap-5 overflow-x-auto no-scrollbar pb-8 -mx-4 px-4 pt-2">
                {activeDeals.map((deal) => (
                  <div key={deal.id} className={`glass-card-premium min-w-[260px] p-6 rounded-[2rem] ${deal.border} group cursor-pointer`}>
                    <div className={`absolute inset-0 bg-gradient-to-br ${deal.gradient} opacity-30 group-hover:opacity-50 transition-opacity duration-500`} />
                    <div className="relative z-10 flex flex-col h-full justify-between">
                      <div className="space-y-2">
                        <span className="text-2xl filter drop-shadow-lg">{deal.icon}</span>
                        <h3 className="text-lg font-bold text-slate-800 font-display leading-tight">{deal.title}</h3>
                      </div>
                      <div className="flex items-end justify-between mt-4">
                        <p className="text-xs font-medium text-slate-500 leading-relaxed max-w-[190px]">{deal.desc}</p>
                        <div className="w-8 h-8 rounded-full bg-white/50 backdrop-blur-md flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform">
                          <span className="text-slate-800 text-lg font-bold">→</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <CategoryBar
            categories={validCategories}
            activeCategoryId={activeCategoryId}
            onSelect={setActiveCategoryId}
          />

          <div className="relative mt-12 min-h-[400px]">
            {activeCategoryId !== 'all' && !searchQuery && (
              <div className="flex items-center gap-3 mb-8 px-2">
                <span className="text-2xl animate-pulse">🔥</span>
                <div>
                  <h2 className="text-2xl font-bold text-slate-800 m-0 font-display leading-none">
                    {categories.find(c => c.id === activeCategoryId)?.name_en || 'Items'}
                  </h2>
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mt-1">
                    Select Items
                  </p>
                </div>
              </div>
            )}

            <AnimatePresence mode='wait'>
              {renderContent}
            </AnimatePresence>
          </div>
        </main>
      </div>

      {/* Right Sidebar */}
      <CartSidebar
        cart={cart}
        isOpen={isSidebarOpen}
        onUpdateQuantity={updateQuantity}
        onRemove={removeFromCart}
        onCheckout={() => setCheckoutOpen(true)}
        onClose={() => setSidebarOpen(false)}
      />

      {/* Checkout Modal */}
      <CheckoutModal
        isOpen={isCheckoutOpen}
        onClose={() => setCheckoutOpen(false)}
        branchId={branch?.id}
        totalAmount={total}
        cartItems={cart}
        calculatePoints={calculatePotentialPoints}
        getCustomerPoints={getCustomerPoints}
        calculateApplicableDiscounts={calculateApplicableDiscounts}
        onSubmit={async (details, discountId, finalTotal, breakdown) => {
          if (!branch?.id) return { success: false };
          const result = await submitOrder(branch.id, cart, details, discountId, finalTotal, undefined, breakdown, branch.name);
          if (result.success) {
            // Save identity for tracking
            localStorage.setItem('foodboot_user', JSON.stringify({
              id: result.customerId,
              name: details.name,
              phone: details.phone
            }));

            setCart([]); // Clear cart on success
            return { success: true, orderId: result.orderId, customerId: result.customerId };
          }
          alert(result.error || 'Failed to submit order');
          return { success: false };
        }}
      />

      {/* Order Tracker Sidebar */}
      <OrderTracker
        isOpen={isTrackerOpen}
        onClose={() => setTrackerOpen(false)}
      />

      {/* Review Sidebar */}
      <ReviewSidebar
        isOpen={isReviewsOpen}
        onClose={() => setReviewsOpen(false)}
        branchId={branch?.id}
      />

      {/* Floating Reviews Button */}
      {branch && (
        <button
          onClick={() => setReviewsOpen(true)}
          className="fixed left-6 bottom-6 z-50 bg-white shadow-2xl rounded-2xl p-4 flex items-center gap-3 border border-slate-100 group hover:scale-105 transition-all"
        >
          <div className="w-10 h-10 bg-amber-50 rounded-xl flex items-center justify-center text-amber-500 group-hover:bg-amber-100 transition-colors">
            <Star className="w-6 h-6 fill-amber-500" />
          </div>
          <div className="text-left pr-2">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none">Reviews</span>
              {reviewStats.count > 0 && (
                <div className="flex items-center gap-0.5 px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-md">
                  <span className="text-[8px] font-black leading-none">{reviewStats.avgRating}</span>
                </div>
              )}
            </div>
            <p className="text-sm font-black text-slate-800 leading-none">
              {reviewStats.count > 0 ? `${reviewStats.count} Customers` : 'View Feed'}
            </p>
          </div>
        </button>
      )}

      {/* Product Detail Modal */}
      <ProductModal
        item={selectedItem}
        onClose={() => setSelectedItem(null)}
        onAdd={(item, qty) => {
          // Add specific quantity
          setCart(prev => {
            const existing = prev.find(i => i.id === item.id);
            if (existing) {
              return prev.map(i => i.id === item.id ? { ...i, quantity: i.quantity + qty } : i);
            }
            return [...prev, { ...item, quantity: qty }];
          });
          setSidebarOpen(true);
        }}
      />

    </div>
  );
};

export default App;
