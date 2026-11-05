import { initializeApp } from "firebase-admin/app";
import { setGlobalOptions } from "firebase-functions/v2";

initializeApp();
setGlobalOptions({ region: "us-central1", maxInstances: 10 });

export { api } from "./api";
export { kfZernioWebhook } from "./webhook";
export { kfReplyToComment, kfReplyToDm, kfHideComment } from "./comments";
export { kfAgentOnComment, kfAgentOnDm, kfSuggestReply, kfTestAgent } from "./agent";
export { kfGetSlots, kfBookSlot, kfConfirmBooking, kfCancelBooking, kfExpireHolds, kfQuoteSlots, kfQuoteBook } from "./agenda";
export { kfFlagStaleLeads } from "./followups";
