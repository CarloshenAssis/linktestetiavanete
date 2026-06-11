-- Cria o bucket de storage "materials" (as políticas já existem na migration anterior).
insert into storage.buckets (id, name, public, file_size_limit)
values ('materials', 'materials', true, 209715200)  -- 200 MB
on conflict (id) do update set public = true, file_size_limit = 209715200;
