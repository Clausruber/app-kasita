import { initializeApp } from "firebase-admin/app";
import { setGlobalOptions } from "firebase-functions/v2";

initializeApp();
setGlobalOptions({ region: "us-central1", maxInstances: 10 });

export { dfZernioWebhook } from "./webhook";
export { dfReplyToComment, dfReplyToDm, dfHideComment } from "./comments";
export { dfAgentOnComment, dfAgentOnDm, dfSuggestReply } from "./agent";
export { dfGetSlots, dfBookSlot, dfConfirmBooking, dfCancelBooking, dfExpireHolds } from "./agenda";
