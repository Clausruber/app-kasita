import { initializeApp } from "firebase-admin/app";
import { setGlobalOptions } from "firebase-functions/v2";

initializeApp();
setGlobalOptions({ region: "us-central1", maxInstances: 10 });

export { alZernioWebhook } from "./webhook";
export { alReplyToComment, alReplyToDm, alHideComment } from "./comments";
export { alAgentOnComment, alAgentOnDm, alSuggestReply } from "./agent";
export { alGetSlots, alBookSlot, alConfirmBooking, alCancelBooking, alExpireHolds } from "./agenda";
