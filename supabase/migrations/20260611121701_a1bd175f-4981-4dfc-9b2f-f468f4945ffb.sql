
-- Enum roles
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

-- user_roles
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users read own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- First signed-up user becomes admin automatically
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Site settings (verse of the day)
CREATE TABLE public.site_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz DEFAULT now()
);
GRANT SELECT ON public.site_settings TO anon, authenticated;
GRANT ALL ON public.site_settings TO service_role;
ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone read settings" ON public.site_settings FOR SELECT USING (true);
CREATE POLICY "admin manage settings" ON public.site_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.site_settings (key, value) VALUES
  ('verse_of_day', 'Ensina a criança no caminho em que deve andar, e ainda quando for velho não se desviará dele. — Provérbios 22:6');

-- Materials
CREATE TYPE public.material_category AS ENUM ('mensagens', 'imagens', 'pdfs');

CREATE TABLE public.materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  category material_category NOT NULL,
  description text,
  file_path text NOT NULL,
  file_url text NOT NULL,
  file_name text,
  file_size bigint,
  mime_type text,
  likes_count int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_materials_category ON public.materials(category, created_at DESC);
GRANT SELECT ON public.materials TO anon, authenticated;
GRANT ALL ON public.materials TO service_role;
GRANT INSERT, UPDATE, DELETE ON public.materials TO authenticated;
ALTER TABLE public.materials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone read materials" ON public.materials FOR SELECT USING (true);
CREATE POLICY "admin insert materials" ON public.materials FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admin update materials" ON public.materials FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admin delete materials" ON public.materials FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
-- allow anonymous likes_count increments via dedicated RPC below

-- Comments (no login required, store name)
CREATE TABLE public.comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id uuid NOT NULL REFERENCES public.materials(id) ON DELETE CASCADE,
  author_name text NOT NULL,
  content text NOT NULL,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX idx_comments_material ON public.comments(material_id, created_at DESC);
GRANT SELECT, INSERT ON public.comments TO anon, authenticated;
GRANT ALL ON public.comments TO service_role;
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone read comments" ON public.comments FOR SELECT USING (true);
CREATE POLICY "anyone insert comments" ON public.comments FOR INSERT
  WITH CHECK (char_length(author_name) BETWEEN 1 AND 80 AND char_length(content) BETWEEN 1 AND 1000);
CREATE POLICY "admin delete comments" ON public.comments FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Like RPC (anonymous-safe, increments counter)
CREATE OR REPLACE FUNCTION public.like_material(_material_id uuid)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_count int;
BEGIN
  UPDATE public.materials SET likes_count = likes_count + 1
    WHERE id = _material_id RETURNING likes_count INTO new_count;
  RETURN new_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.like_material(uuid) TO anon, authenticated;
