# Guia de publicação — Site da Tia Vanete

O código já está **conectado ao seu novo Supabase** (`ixoiwfqsyetyrivxrmbe`) pelo
arquivo `.env`, o build foi testado e gera saída pronta para a Vercel. Faltam
**3 passos** que só podem ser feitos com o seu login (eu não tenho acesso ao
painel do Supabase nem ao da Vercel).

---

## Passo 1 — Criar as tabelas e o storage no Supabase

1. Abra o **SQL Editor** do seu projeto:
   https://supabase.com/dashboard/project/ixoiwfqsyetyrivxrmbe/sql/new
2. Abra o arquivo [`supabase/setup.sql`](supabase/setup.sql) deste projeto,
   copie **todo** o conteúdo e cole no editor.
3. Clique em **Run**.

Isso cria tudo de uma vez (pode rodar de novo sem problema):

- Tabelas: `user_roles`, `site_settings`, `materials`, `comments`
- Função que torna **o primeiro cadastro automaticamente admin** (a Tia Vanete)
- Função de curtir sem login (`like_material`)
- **Bucket de storage `materials`** (público, até 200 MB) + permissões de upload só para admin

✔️ Confira em **Storage** que apareceu o bucket `materials`:
https://supabase.com/dashboard/project/ixoiwfqsyetyrivxrmbe/storage/buckets

---

## Passo 2 — Liberar login imediato (sem confirmação de e-mail)

Por padrão o Supabase exige confirmar o e-mail antes de entrar. Para a Tia Vanete
conseguir entrar logo após criar a conta:

1. Abra: https://supabase.com/dashboard/project/ixoiwfqsyetyrivxrmbe/auth/providers
2. Em **Email**, **desligue** a opção **"Confirm email"** e salve.

(Se preferir manter ligado, é só confirmar pelo e-mail que chega após o cadastro.)

### Criar a conta de admin
- Rode o site (Passo 3) e acesse **`/auth`**.
- Clique em **"Primeiro acesso? Criar conta"**, use o **e-mail e senha** da Tia
  Vanete e crie a conta.
- Como é o **primeiro usuário**, ele vira **admin** automaticamente e já pode
  postar materiais no painel `/admin`.

---

## Passo 3 — Publicar grátis na Vercel

O jeito mais simples e gratuito é conectar o repositório do GitHub:

1. Entre em https://vercel.com com sua conta GitHub.
2. **Add New… → Project** e selecione o repositório `linktestetiavanete`.
3. A Vercel já detecta o build pelo `vercel.json` deste projeto. Pode deixar tudo
   no padrão:
   - **Build Command:** `npm run build`
   - **Install Command:** `npm install`
   - **Framework Preset:** Other
4. (Opcional, recomendado) Em **Settings → Environment Variables**, adicione as
   mesmas chaves do `.env`:
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_URL`,
   `SUPABASE_PUBLISHABLE_KEY` (a chave **anon** é pública, pode usar à vontade).
5. Clique em **Deploy**.

> Já enviei a configuração do Nitro para o preset **vercel**, então o build gera
> `.vercel/output` e a Vercel serve o site (SSR) automaticamente.

### Alternativa por linha de comando
```bash
npm i -g vercel
vercel login
vercel --prod
```

---

## Depois de publicar
- Pegue a URL da Vercel (ex.: `https://linktestetiavanete.vercel.app`).
- No Supabase **Auth → URL Configuration**, adicione essa URL em **Site URL** e
  **Redirect URLs** para o login funcionar 100%:
  https://supabase.com/dashboard/project/ixoiwfqsyetyrivxrmbe/auth/url-configuration

Pronto! O site fica no ar com carrosséis de Mensagens, Imagens e PDFs, curtir e
comentar sem login, download de PDFs e o painel admin da Tia Vanete. 🌈
