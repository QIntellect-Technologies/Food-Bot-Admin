import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config();
config({ path: '.env.local' });

const supabase = createClient(
    process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '',
    process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
);

async function purgeAllData() {
    console.log('🗑️ FINAL ATTEMPT AT DATABASE PURGE...\n');

    try {
        // 1. Delete all orders (Using a filter that is always true for strings/ids)
        console.log('📦 Purging ORDERS...');
        const { error: err1 } = await supabase.from('orders').delete().filter('id', 'neq', '00000000-0000-0000-0000-000000000000');
        if (err1) console.error('Error orders:', err1.message);

        // 2. Delete all voice orders
        console.log('🎙️ Purging VOICE ORDERS...');
        const { error: err5 } = await supabase.from('voice_text_orders').delete().filter('order_id', 'neq', '00000000-0000-0000-0000-000000000000');
        if (err5) console.error('Error voice orders:', err5.message);

        // 3. Delete all customers (just in case)
        console.log('👥 Purging CUSTOMERS...');
        await supabase.from('customers').delete().filter('id', 'neq', '00000000-0000-0000-0000-000000000000');

        console.log('\n✨ PURGE OPERATION CALLED.');
        console.log('🚀 Checking final state...');

    } catch (error) {
        console.error('❌ Purge failed:', error.message);
    }
}

purgeAllData();
