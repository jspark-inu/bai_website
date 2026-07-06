export type MemberPublic = {
  id: number;
  name: string;
  role: string;
};

export type MemberPrivate = MemberPublic & {
  password_hash: string;
  status: string;
};

export type Material = {
  id: number;
  author_id: number;
  title: string;
  body: string;
  url: string;
  file_url: string;
  file_name: string;
  category: string;
  guild: string;
  created_at: string;
  updated_at: string;
  author_name: string;
  author_role: string;
};
