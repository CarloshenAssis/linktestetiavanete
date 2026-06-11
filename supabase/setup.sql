-- ============================================================================
-- Tia Vanete — Setup completo do Supabase (cole tudo no SQL Editor e RUN)
-- Projeto: ixoiwfqsyetyrivxrmbe
-- Seguro para rodar mais de uma vez (idempotente).
-- ============================================================================

-- ---------- ENUMS ----------
do $$ begin
  create type public.app_role as enum ('admin', 'user');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.material_category as enum ('mensagens', 'imagens', 'pdfs');
exception when duplicate_object then null; end $$;

-- ---------- TABELA: user_roles ----------
create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  role app_role not null,
  created_at timestamptz default now(),
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;
drop policy if exists "users read own roles" on public.user_roles;
create policy "users read own roles" on public.user_roles
  for select to authenticated using (auth.uid() = user_id);

-- Função de checagem de papel (admin)
create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

-- Primeiro usuário cadastrado vira admin automaticamente (a Tia Vanete)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.user_roles where role = 'admin') then
    insert into public.user_roles (user_id, role) values (new.id, 'admin');
  else
    insert into public.user_roles (user_id, role) values (new.id, 'user');
  end if;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- ---------- TABELA: site_settings (versículo do dia) ----------
create table if not exists public.site_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz default now()
);
grant select on public.site_settings to anon, authenticated;
grant all on public.site_settings to service_role;
alter table public.site_settings enable row level security;
drop policy if exists "anyone read settings" on public.site_settings;
create policy "anyone read settings" on public.site_settings for select using (true);
drop policy if exists "admin manage settings" on public.site_settings;
create policy "admin manage settings" on public.site_settings for all to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

insert into public.site_settings (key, value) values
  ('verse_of_day', 'Ensina a criança no caminho em que deve andar, e ainda quando for velho não se desviará dele. — Provérbios 22:6')
on conflict (key) do nothing;

-- ---------- TABELA: materials ----------
create table if not exists public.materials (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category material_category not null,
  description text,
  file_path text not null,
  file_url text not null,
  file_name text,
  file_size bigint,
  mime_type text,
  likes_count int not null default 0,
  created_at timestamptz default now()
);
create index if not exists idx_materials_category on public.materials(category, created_at desc);
grant select on public.materials to anon, authenticated;
grant all on public.materials to service_role;
grant insert, update, delete on public.materials to authenticated;
alter table public.materials enable row level security;
drop policy if exists "anyone read materials" on public.materials;
create policy "anyone read materials" on public.materials for select using (true);
drop policy if exists "admin insert materials" on public.materials;
create policy "admin insert materials" on public.materials for insert to authenticated
  with check (public.has_role(auth.uid(), 'admin'));
drop policy if exists "admin update materials" on public.materials;
create policy "admin update materials" on public.materials for update to authenticated
  using (public.has_role(auth.uid(), 'admin'));
drop policy if exists "admin delete materials" on public.materials;
create policy "admin delete materials" on public.materials for delete to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- ---------- TABELA: comments (curtir/comentar sem login) ----------
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materials(id) on delete cascade,
  author_name text not null,
  content text not null,
  created_at timestamptz default now()
);
create index if not exists idx_comments_material on public.comments(material_id, created_at desc);
grant select, insert on public.comments to anon, authenticated;
grant all on public.comments to service_role;
alter table public.comments enable row level security;
drop policy if exists "anyone read comments" on public.comments;
create policy "anyone read comments" on public.comments for select using (true);
drop policy if exists "anyone insert comments" on public.comments;
create policy "anyone insert comments" on public.comments for insert
  with check (char_length(author_name) between 1 and 80 and char_length(content) between 1 and 1000);
drop policy if exists "admin delete comments" on public.comments;
create policy "admin delete comments" on public.comments for delete to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- ---------- RPC: like_material (curtidas sem login) ----------
create or replace function public.like_material(_material_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare new_count int;
begin
  update public.materials set likes_count = likes_count + 1
    where id = _material_id returning likes_count into new_count;
  return new_count;
end;
$$;

-- Travas de segurança nas funções
revoke execute on function public.has_role(uuid, app_role) from public, anon;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.like_material(uuid) to anon, authenticated;

-- ============================================================================
-- STORAGE: bucket "materials" para upload de imagens, PDFs e textos
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit)
values ('materials', 'materials', true, 209715200)  -- 200 MB
on conflict (id) do update set public = true, file_size_limit = 209715200;

-- Políticas de storage: leitura pública, escrita só admin
drop policy if exists "public read materials files" on storage.objects;
create policy "public read materials files" on storage.objects for select
  using (bucket_id = 'materials');

drop policy if exists "admin upload materials" on storage.objects;
create policy "admin upload materials" on storage.objects for insert to authenticated
  with check (bucket_id = 'materials' and public.has_role(auth.uid(), 'admin'));

drop policy if exists "admin update materials files" on storage.objects;
create policy "admin update materials files" on storage.objects for update to authenticated
  using (bucket_id = 'materials' and public.has_role(auth.uid(), 'admin'));

drop policy if exists "admin delete materials files" on storage.objects;
create policy "admin delete materials files" on storage.objects for delete to authenticated
  using (bucket_id = 'materials' and public.has_role(auth.uid(), 'admin'));

-- Pronto! ✅
