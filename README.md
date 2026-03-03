# Sticker Voter (Vercel + Supabase)

This repo now includes:
- Next.js app (public poll list, poll vote page, admin page)
- Supabase SQL schema with RLS, storage policies, and voting RPC
- Google OAuth-ready auth flow via Supabase Auth

Core voting rules already implemented:
- Admin can create new polls and upload sticker designs.
- User can vote for up to `max_votes_per_user` options (default `8`).
- Poll can be closed manually (`status='closed'`) or automatically by `ends_at`.

## 1) Supabase setup

1. Create a Supabase project.
2. Open SQL Editor and run [`supabase/schema.sql`](./supabase/schema.sql).
3. In **Authentication > Providers**, enable Google and set redirect URLs:
   - local app origins: `http://localhost:3000` and `http://localhost:3001` (if you use both)
   - local callback URLs: `http://localhost:3000/auth/callback` and `http://localhost:3001/auth/callback`
   - production callback URL: `https://YOUR_DOMAIN/auth/callback`
4. Promote your account to admin (replace with your user UUID):

```sql
insert into public.user_roles (user_id, role)
values ('YOUR_AUTH_USER_UUID', 'admin')
on conflict (user_id) do update set role = 'admin';
```

## 2) Run locally

1. Copy envs:
```bash
cp .env.example .env.local
```
2. Fill in Supabase URL + publishable key in `.env.local`.
3. Install and run:
```bash
npm install
npm run dev
```

## 3) Deploy to Vercel

1. Push this repo to GitHub.
2. Import project in Vercel.
3. Add environment variables from [`.env.example`](./.env.example).
4. Deploy.

## 4) RPC used by vote page

```ts
await supabase.rpc("set_poll_votes", {
  p_poll_id: pollId,
  p_option_ids: selectedOptionIds
});
```

- Passing an empty array clears current user's votes (while poll is open).
- Server-side checks prevent invalid options and over-limit selections.
