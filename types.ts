export enum UserRole {
  MAIN_ADMIN = 'Main Admin',
  BRANCH_ADMIN = 'Branch Admin',
  STAFF = 'Staff',
  GUEST = 'Guest'
}

export enum AvailabilityStatus {
  AVAILABLE = 'Available',
  LIMITED = 'Limited',
  OUT_OF_STOCK = 'Out of Stock'
}

export interface MenuItem {
  id?: string;    // Database ID (Guid)
  key: string;
  category: string;
  category_id: string; // ID for database relations
  subcategory?: string; // Subcategory for nested filtering (e.g., "Burgers", "Pizza")
  name_en: string;
  name_ar: string;
  price: number;
  stock?: number;        // Current stock level
  minStockThreshold?: number; // Threshold for blinking warning
  status: AvailabilityStatus;
  isOutOfStock?: boolean; // Keep for legacy compatibility or auto-toggle
  availableMeals?: string[]; // 'Breakfast', 'Lunch', 'Dinner', 'High Tea'
  cuisineType?: string;      // 'Fast Food', 'Desi', 'General'
}

export interface OperationalHours {
  open: string;
  close: string;
  isClosed: boolean;
}

export interface BranchSettings {
  workingDays: {
    [key: string]: OperationalHours;
  };
  holidayMode: {
    active: boolean;
    notice: string;
  };
  // Quick Actions Controls
  isOnlinePaused: boolean;
  isVoicePaused: boolean;
  kitchenBusyMode: boolean;
  emergencyStop: {
    active: boolean;
    until: string | null; // ISO timestamp
  };
}

// --- Staff Types ---
export enum StaffRole {
  MANAGER = 'Manager',
  CHEF = 'Chef',
  CASHIER = 'Cashier',
  SUPERVISOR = 'Supervisor',
  HELPER = 'Helper',
  RIDER = 'Rider'
}

export interface AttendanceRecord {
  date: string;
  status: 'Present' | 'Absent' | 'Late' | 'Half Day';
  checkIn?: string;
  checkOut?: string;
  overtimeHours?: number;
  notes?: string;
}

export interface PerformanceLog {
  month: string;
  ordersHandled: number;
  successRate: number;
  avgPrepTime: number;
  mistakes: number;
  managerRating: number;
  feedback?: string;
}

export interface StaffDocument {
  id: string;
  type: 'ID' | 'Contract' | 'Health Certificate' | 'Training' | 'Other';
  name: string;
  expiryDate?: string;
  fileUrl: string;
  status: 'Valid' | 'Expired' | 'Pending';
}

export interface StaffMember {
  id: string;
  name: string;
  role: StaffRole;
  avatar: string;
  email: string;
  phone: string;
  emergencyContact?: string;
  joinDate: string;
  status: 'Active' | 'On Leave' | 'Suspended' | 'Disabled';
  shift: {
    start: string;
    end: string;
    days: string[];
    type: 'Morning' | 'Evening' | 'Night';
  };
  metrics: {
    lifetimeOrders: number;
    ordersToday: number;
    ordersThisWeek: number;
    avgOrdersPerShift: number;
    avgPrepTime: number; // minutes
    fastestPrep: number;
    slowestPrep: number;
    peakHourPerformance: number; // 0-100 score
    successRate: number; // 0-100
    delayedOrders: number;
    reassignedOrders: number;
    mistakes: number; // wrong item, etc.
    cancellationByStaff: number;
    customerSatisfaction: number; // 0-5
    rating: number; // 0-5
    wastageIncidents: number;
    estimatedLoss: number;
  };
  financials: {
    salary: number;
    currency: string;
    paidThisMonth: number;
    pendingAmount: number;
    bonuses: number;
    penalties: number;
    history: {
      month: string;
      base: number;
      bonus: number;
      penalty: number;
      status: 'Paid' | 'Pending';
    }[];
  };
  attendance: AttendanceRecord[];
  performanceHistory: PerformanceLog[];
  documents: StaffDocument[];
  systemAccess: {
    lastActive: string;
    permissions: string[];
    recentActions: {
      action: string;
      timestamp: string;
      details: string;
    }[];
  };
}

export interface Branch {
  id: string;
  name: string;
  location: string;
  manager: string; // Operational Manager
  email: string;   // Branch Email
  phone: string;   // Branch Phone

  // New Owner Details & Credentials
  ownerName: string;
  ownerEmail: string;
  ownerPhone: string;
  ownerUsername?: string;
  ownerPassword?: string;

  status: 'Active' | 'Inactive' | 'Closed' | 'Maintenance';
  menu: MenuItem[];
  settings: BranchSettings;
  staff: StaffMember[]; // New field
}

export interface StatsData {
  name: string;
  value: number;
  color?: string;
}

export interface AuditLogEntry {
  id: string;
  userName: string;
  userRole: UserRole;
  branchId?: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'EXPORT' | 'ORDER_MOD' | 'STOCK_MOD' | 'FIN_MOD';
  details: string;
  timestamp: string;
  ipAddress?: string;
  status: 'Success' | 'Failed';
}

export type SyncEventType =
  | 'SYNC_BRANCH_UPDATE'
  | 'SYNC_MENU_UPDATE'
  | 'SYNC_NOTIFICATION'
  | 'SYNC_NEW_ORDER'
  | 'SYNC_ORDER_UPDATE'
  | 'SYNC_STOCK_ALERT'
  | 'SYNC_AUDIT_LOG'
  | 'SYNC_STAFF_UPDATE';

export type ViewState = 'DASHBOARD' | 'MENU_MANAGER' | 'BRANCHES' | 'BRANCH_OWNERS' | 'SETTINGS' | 'ORDERS' | 'USERS' | 'DISCOUNTS' | 'REVIEWS' | 'LOYALTY';
export type TimeRange = 'Today' | 'Yesterday' | 'Last Week' | 'Month' | 'All Time' | 'Custom';

export enum LiveOrderStatus {
  PENDING = 'Pending',
  PREPARING = 'Preparing',
  READY = 'Ready',
  COMPLETED = 'Completed',
  CANCELLED = 'Cancelled'
}

export type KitchenItemStatus = 'Pending' | 'Cooking' | 'Ready' | 'Served';

export interface KitchenItem {
  name: string;
  qty: number;
  // Kitchen Workflow Fields
  chefId?: string;
  status?: KitchenItemStatus;
  startedAt?: string;
  completedAt?: string;
  price?: number; // Optional price for history
  notes?: string; // Special instructions for kitchen
}

export interface LiveOrder {
  id: string;
  customerName: string;
  customerAvatar: string;
  items: KitchenItem[];
  total: number;
  status: LiveOrderStatus;
  timestamp: string;
  elapsedMinutes: number;
}

export interface Review {
  id: string;
  branch_id: string;
  order_id: string;
  customer_id: string;
  customer_name: string;
  rating: number; // 1-5
  comment: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  created_at: string;
  branches?: {
    name: string;
  };
}

export interface SystemNotification {
  id: string;
  title: string;
  message: string;
  timestamp: string;
  type: 'info' | 'success' | 'warning' | 'error';
  isRead: boolean;
  recipientRole: UserRole | 'ALL';
  targetBranchId?: string; // If specific to a branch owner
}

export interface LoyaltyRule {
  id: string;
  name: string;
  description: string;
  type: 'EARN_RULE' | 'REDEEM_RULE' | 'TIER_RULE';
  condition_type: 'SPEND_AMOUNT' | 'ORDER_COUNT';
  condition_value: number;
  reward_type: 'POINTS' | 'DISCOUNT_PERCENT' | 'DISCOUNT_FIXED';
  reward_value: number;
  target_audience: string;
  is_active: boolean;
  start_date?: string;
  end_date?: string;
  branch_id?: string;
}