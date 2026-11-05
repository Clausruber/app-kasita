// Single source of truth for Firestore paths. Everything hangs off ROOT.
// Keep in sync with functions/src/paths.ts.
export const ROOT = "kafona-data";
export const SYSTEM = "_system";
// Own collection id for comments/DMs: collectionGroup queries of other apps in the project
// (which use "messages") never see these docs, and ours never see theirs.
export const MESSAGES = "kfMessages";

export const userDoc = (uid: string) => `${ROOT}/${uid}`;
export const postsCol = (uid: string) => `${ROOT}/${uid}/posts`;
export const postDoc = (uid: string, postId: string) => `${postsCol(uid)}/${postId}`;
export const postMessagesCol = (uid: string, postId: string) => `${postDoc(uid, postId)}/${MESSAGES}`;
export const accountsCol = (uid: string) => `${ROOT}/${uid}/accounts`;
export const conversationsCol = (uid: string) => `${ROOT}/${uid}/conversations`;
export const conversationMessagesCol = (uid: string, convId: string) =>
  `${conversationsCol(uid)}/${convId}/${MESSAGES}`;

// Server-only lookup indexes (clients are denied by rules).
export const zernioProfileIndex = (profileId: string) =>
  `${ROOT}/${SYSTEM}/zernioProfiles/${profileId}`;
export const zernioAccountIndex = (accountId: string) =>
  `${ROOT}/${SYSTEM}/zernioAccounts/${accountId}`;
export const aiKeyDoc = (uid: string) => `${ROOT}/${SYSTEM}/aiKeys/${uid}`;
// Per-account Zernio credentials and status, set by the SuperAdmin (server-only).
export const tenantDoc = (uid: string) => `${ROOT}/${SYSTEM}/tenants/${uid}`;
export const tenantsCol = () => `${ROOT}/${SYSTEM}/tenants`;
// Global AI provider settings (OpenRouter key + text model), set by the SuperAdmin.
export const globalAiDoc = () => `${ROOT}/${SYSTEM}/global/ai`;
// Agent knowledge: compiled manual + one doc per uploaded PDF (server-only).
export const aiKnowledgeDoc = (uid: string) => `${ROOT}/${SYSTEM}/aiKnowledge/${uid}`;
export const aiKnowledgeFilesCol = (uid: string) => `${aiKnowledgeDoc(uid)}/files`;
export const zernioPostIndex =(zernioPostId: string) =>
  `${ROOT}/${SYSTEM}/zernioPosts/${zernioPostId}`;
// Service agendas: weekly hours per service, a per-day lock doc and the bookings.
export const agendasCol = (uid: string) => `${ROOT}/${uid}/agendas`;
export const agendaDoc = (uid: string, agendaId: string) => `${agendasCol(uid)}/${agendaId}`;
export const agendaDayDoc = (uid: string, agendaId: string, day: string) => `${agendaDoc(uid, agendaId)}/days/${day}`;
export const bookingsCol = (uid: string) => `${ROOT}/${uid}/bookings`;
// Contacts (people who commented or wrote a DM), editable on the Clientes page.
export const clientsCol = (uid: string) => `${ROOT}/${uid}/clients`;
export const clientDoc = (uid: string, clientId: string) => `${clientsCol(uid)}/${clientId}`;
// Team: members of an owner's workspace, plus server-only indexes (member uid → workspace, invite token hash → member).
export const membersCol = (uid: string) => `${ROOT}/${uid}/members`;
export const memberDoc = (uid: string, memberId: string) => `${membersCol(uid)}/${memberId}`;
export const memberIndexDoc = (memberUid: string) => `${ROOT}/${SYSTEM}/members/${memberUid}`;
export const inviteDoc = (tokenHash: string) => `${ROOT}/${SYSTEM}/invites/${tokenHash}`;
// Properties, sales pipeline and follow-ups. Property photos live in Storage under `${propertyDoc}/…`.
export const propertiesCol = (uid: string) => `${ROOT}/${uid}/properties`;
export const propertyDoc = (uid: string, propertyId: string) => `${propertiesCol(uid)}/${propertyId}`;
export const dealsCol = (uid: string) => `${ROOT}/${uid}/deals`;
export const dealDoc = (uid: string, dealId: string) => `${dealsCol(uid)}/${dealId}`;
export const salesCol = (uid: string) => `${ROOT}/${uid}/sales`;
export const tasksCol = (uid: string) => `${ROOT}/${uid}/tasks`;
export const taskDoc = (uid: string, taskId: string) => `${tasksCol(uid)}/${taskId}`;
// Logos for post photos (Ajustes → Imágenes), uploaded to Firebase Storage.
export const brandingPath = (uid: string) => `${ROOT}/${uid}/branding`;
// Catalogs / quotes (PDF) generated from the inbox, a property or a client.
export const quotesCol = (uid: string) => `${ROOT}/${uid}/quotes`;
export const quoteDoc = (uid: string, quoteId: string) => `${quotesCol(uid)}/${quoteId}`;
// Public quote links: token → { uid, quoteId } (server-only index, like the Zernio ones).
export const quoteTokenDoc = (token: string) => `${ROOT}/${SYSTEM}/quoteTokens/${token}`;
