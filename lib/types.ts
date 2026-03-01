export type Poll = {
  id: string;
  title: string;
  description: string | null;
  status: "draft" | "open" | "closed";
  starts_at: string | null;
  ends_at: string | null;
  max_votes_per_user: number;
  created_by: string;
  created_at: string;
};

export type PollOption = {
  id: string;
  poll_id: string;
  title: string | null;
  image_path: string;
  display_order: number;
};

export type PollOptionResult = {
  poll_id: string;
  option_id: string;
  title: string | null;
  image_path: string;
  display_order: number;
  vote_count: number;
};
