import type { Timestamp } from "firebase/firestore";

export type PostTarget = {
  platform: string;
  accountId: string | null;
  status?: string;
  url?: string | null;
  error?: string | null;
};

export type Post = {
  id: string;
  content: string;
  mediaItems: { url: string; type?: string }[];
  platforms: PostTarget[];
  status: string;
  scheduledFor: Timestamp;
  source: "app" | "external";
  commentCount: number;
  unreadCount: number;
  hidden?: boolean;
  // Filled by /api/inbox/sync from Zernio
  picture?: string | null;
  permalink?: string | null;
  accountUsername?: string | null;
  likeCount?: number;
  platformCommentCount?: number;
  lastCommentAt?: Timestamp | null;
};

export type AiSettings = {
  mode: "off" | "manual" | "auto";
  textModel: string | null;
  instructions: string;
  brand: { name: string; tone: string; about: string; faq: string; never: string };
  hasKey: boolean;
  keyHint: string | null;
};

export type DraftBooking = { id: string; service: string; label: string; start: number };
export type ClientFieldName = "firstName" | "lastName" | "whatsapp" | "email";
export type DraftClient = { platform: string; authorId: string; fields: Partial<Record<ClientFieldName, string>> };
export type AiDraft = {
  text: string;
  model: string;
  needsHuman: boolean;
  reason: string | null;
  booking?: DraftBooking | null; // slot held by the agent, confirmed when the reply is sent
  client?: DraftClient | null; // client data the person gave, saved to the card when the reply is sent
  at: Timestamp | null;
};

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type TimeRange = { start: string; end: string };
export type Agenda = {
  id: string;
  service: string;
  description: string;
  price: string;
  durationMin: number;
  bufferMin: number;
  timezone: string;
  weekly: Partial<Record<Weekday, TimeRange[]>>;
  blockedDates: string[];
  minNoticeMin: number;
  maxDaysAhead: number;
  active: boolean;
};

export type BookingStatus = "held" | "confirmed" | "cancelled" | "expired";
export type Booking = {
  id: string;
  agendaId: string;
  service: string;
  timezone: string;
  date: string;
  time: string;
  start: Timestamp;
  end: Timestamp;
  status: BookingStatus;
  holdExpiresAt: Timestamp | null;
  customer: { name: string; platform?: string | null; username?: string | null; contact?: string | null };
  channel: { kind: "comment" | "dm" | "admin"; postId?: string; conversationId?: string };
  source: "ai" | "admin";
  notes: string;
};

export type Conversation = {
  id: string;
  platform: string;
  accountId: string | null;
  participant?: { name: string; picture: string | null };
  lastMessage: string;
  lastMessageAt: Timestamp | null;
  unreadCount?: number;
};

export type AccountDoc = {
  id: string;
  platform: string;
  username: string | null;
  picture: string | null;
  isActive?: boolean;
};

export type Message = {
  id: string;
  kind: "comment" | "dm";
  uid: string;
  postId?: string;
  conversationId?: string;
  commentId?: string;
  parentId?: string | null;
  platform: string;
  author: { name: string; username: string | null; picture: string | null };
  text: string;
  attachmentUrl?: string | null;
  direction: "in" | "out";
  read: boolean;
  hidden?: boolean;
  replied?: boolean;
  sentBy?: "ai" | "user";
  aiStatus?: "pending" | "drafted" | "sent" | "skipped" | "error";
  aiDraft?: AiDraft | null;
  aiError?: string | null;
  booking?: (DraftBooking & { status: BookingStatus }) | null; // booking confirmed with this reply
  createdAt: Timestamp | null;
  path: string; // full Firestore path, for updates
};

export type Account = {
  _id: string;
  platform: string;
  username?: string;
  displayName?: string;
  profilePicture?: string;
  isActive?: boolean;
};

export type Client = {
  id: string;
  platform: string;
  authorId: string;
  displayName: string;
  username: string | null;
  picture: string | null;
  firstName: string;
  lastName: string;
  whatsapp: string;
  email: string;
  notes: string;
  extra: { label: string; value: string }[];
  aiEdited: Partial<Record<ClientFieldName, string>>; // field → ISO date the agent last wrote it
  messageCount: number;
  channels: string[];
  lastMessage: string;
  firstContactAt: string | null;
  lastContactAt: string | null;
};
export type ClientBooking = { id: string; service: string; start: string; timezone: string; status: string };
