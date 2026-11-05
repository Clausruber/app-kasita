export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export type ApiUser = {
  uid: string;
  email?: string | null;
  actor: {
    authUid: string;
    uid: string;
    email: string | null;
    isOwner: boolean;
    role: "owner" | "team" | "supervisor" | "admin";
    perms: string[] | null;
    memberId: string | null;
    status: "active" | "inactive";
  };
};

