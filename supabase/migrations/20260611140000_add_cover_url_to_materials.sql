-- Adiciona a coluna de capa (usada principalmente pelos PDFs) na tabela materials.
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS cover_url text;
