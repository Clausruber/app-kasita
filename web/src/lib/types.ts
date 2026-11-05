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
  quoteKeywords: string[];
  quoteKeywordsOnly: boolean;
  hasKey: boolean;
  keyHint: string | null;
};

export type DraftBooking = { id: string; service: string; label: string; start: number; property?: string | null; lane?: string | null };
export type DraftQuote = { propertyId: string; title: string };
/** Quote sent by private reply for a comment (on the comment: quoteDm; on our public reply: quote). */
export type SentQuote = { id: string; folio: string; propertyTitle: string; messageId: string | null; uncertain?: boolean };
export type ClientFieldName = "firstName" | "lastName" | "whatsapp" | "email";
export type DraftClient = { platform: string; authorId: string; fields: Partial<Record<ClientFieldName, string>> };
export type AiDraft = {
  text: string;
  model: string;
  needsHuman: boolean;
  reason: string | null;
  booking?: DraftBooking | null; // slot held by the agent, confirmed when the reply is sent
  client?: DraftClient | null; // client data the person gave, saved to the card when the reply is sent
  quote?: DraftQuote | null; // comments: quote sent to the commenter by private reply (DM) when the reply is sent
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
  lanes?: number; // sub-spaces per time: 2 = A, B (agendas without agents)
  propertyRequired?: boolean; // visits: each booking names the property
  kind?: "visit";
  agents?: "all" | string[] | null; // staffed by people: each booking goes to one free agent
};
/** An agent's own hours for staffed agendas; null weekly = the agenda's hours. */
export type Availability = { weekly: Partial<Record<Weekday, TimeRange[]>> | null; blockedDates: string[] };

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
  channel: { kind: "comment" | "dm" | "admin" | "quote"; postId?: string; conversationId?: string; quoteId?: string };
  source: "ai" | "admin";
  notes: string;
  lane?: string | null; // sub-space (A, B…) when the agenda has more than one
  assigneeId?: string | null; // staffed agenda: "owner" or member id of who attends
  assigneeName?: string | null;
  property?: { id: string; title: string } | null;
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
  attachments?: { url: string; name: string; type: "file" | "image" }[]; // DMs sent from the app (catalog PDF)
  direction: "in" | "out";
  read: boolean;
  hidden?: boolean;
  replied?: boolean;
  sentBy?: "ai" | "user";
  aiStatus?: "pending" | "drafted" | "sent" | "skipped" | "error";
  aiDraft?: AiDraft | null;
  aiError?: string | null;
  booking?: (DraftBooking & { status: BookingStatus }) | null; // booking confirmed with this reply
  quote?: SentQuote | null; // our public reply: the quote sent by private reply with it
  quoteDm?: SentQuote | null; // a comment: the quote already sent to its author by private reply
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

// ---- Inventory, sales pipeline and follow-ups (rows as the API returns them: dates are ISO strings) ----
export type PropertyStatus = "borrador" | "disponible" | "apartado" | "vendido" | "rentado";
export type Operation = "venta" | "renta" | "venta_renta";
export type CloseKind = "venta" | "renta";
// thumb: small copy (THUMB_SIDE px) for lists and pickers; absent on photos not yet backfilled.
export type PropertyPhoto = { path: string; url: string; w?: number; h?: number; size: number; thumb?: string; thumbPath?: string };
export type PropertyReservation = { dealId: string; amount: number; at: string; expiresAt: string };
export type PropertyLease = { dealId: string; monthlyRent: number; deposit: number; months: number; start: string; end: string };
export type Property = {
  id: string;
  demo?: boolean; // test unit loaded from Propiedades → Datos de prueba
  status: PropertyStatus;
  propertyType: string; // Departamento, Casa, Terreno…
  operation: Operation;
  salePrice: number | null; // when operation includes venta
  rentPrice: number | null; // monthly, when operation includes renta
  maintenanceFee: number | null; // monthly
  currency: "MXN";
  bedrooms: number;
  bathrooms: number;
  halfBathrooms: number;
  parking: number;
  builtArea: number | null; // m²
  landArea: number | null; // m²
  floor: string; // "PB", "5", "PH"…
  yearBuilt: number | null;
  furnished: boolean;
  petsAllowed: boolean;
  availableFrom: string | null; // ISO date (rentals)
  development: string; // building / development name
  location: { state: string; city: string; neighborhood: string; lat: number | null; lng: number | null }; // lat/lng: map pin
  address: string; // street and number; "" when the viewer lacks inventory.private
  unit: string; // idem
  ownerName: string; // idem
  ownerPhone: string; // idem
  description: string;
  amenities: string[];
  highlights: string[]; // the agent's selling points ("Remodelada en 2024"), most important first
  title: string;
  stockNumber: string;
  photos: PropertyPhoto[]; // in display order; the cover is first
  reservation: PropertyReservation | null;
  lease: PropertyLease | null; // set while rentado
  hold: PropertyHold | null; // internal notice "Laura lo está mostrando hasta las 17:00" (blocks nothing)
  intakeDate: string;
  closedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type DealStage = "nuevo" | "contactado" | "visita" | "negociacion" | "apartado" | "vendido" | "perdido";
export type Deal = {
  id: string;
  clientId: string | null;
  clientName: string;
  clientPhone: string;
  propertyId: string | null;
  propertyTitle: string | null;
  stage: DealStage;
  assigneeId: string | null; // member id; null = unassigned; "owner" = the account owner
  source: "dm" | "comment" | "manual" | "ai";
  value: number | null;
  notes: string;
  lostReason: string;
  reservation: PropertyReservation | null;
  saleId: string | null;
  closedAs: CloseKind | null; // how a "vendido" (closed) deal ended: sold or rented
  stageChangedAt: string | null;
  createdAt: string | null;
};
export type PaymentMethod = "contado" | "hipotecario" | "infonavit" | "cofinanciamiento";

export type TaskKind = "manual" | "stale_lead" | "reservation_expiry" | "quote_viewed" | "quote_accepted" | "quote_booking" | "hold_expiry" | "lease_end" | "booking";
export type PropertyHold = { byId: string; byName: string; until: string; note: string };
export type Task = {
  id: string;
  title: string;
  notes: string;
  dueAt: string;
  done: boolean;
  doneAt: string | null;
  assigneeId: string | null;
  clientId: string | null;
  dealId: string | null;
  propertyId: string | null;
  conversationId: string | null;
  kind: TaskKind;
  createdAt: string | null;
};
