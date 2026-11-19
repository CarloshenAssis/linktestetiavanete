# Worker da Tia Vanete

O Worker usa um único arquivo, `worker.js`, sem dependências. O cron roda a cada 10 minutos entre 03h00 e 05h50 (horário de São Paulo), 18 lotes por noite; cada lote copia cerca de 15 arquivos por causa do limite de 50 chamadas do plano gratuito. A cópia guarda novas versões dos arquivos sem apagar as anteriores. Quando ainda houver pendências, use **Fazer backup agora** no painel para rodar mais um lote.

## Configuração e publicação

No Google Cloud, habilite a API do Google Drive e crie um cliente OAuth do tipo **Aplicativo da Web**. Cadastre `https://tiavanete-files.carloshen.workers.dev/google/callback` como URI de redirecionamento autorizada. Se o aplicativo estiver em modo de teste, autorize a conta da Tia Vanete como usuária de teste. Para uso contínuo, publique a tela de consentimento, pois o modo de teste expira o acesso offline após sete dias.

No diretório `cloudflare/worker`, com o Wrangler autenticado na conta da Cloudflare, configure os segredos e publique.

```bash
wrangler secret put SUPABASE_ANON_KEY
wrangler secret put MIGRATE_SECRET
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler deploy
```

Também é possível enviar `worker.js` diretamente pela API da Cloudflare como módulo ES. Use os bindings, as variáveis e o cron do `wrangler.toml` e preserve os segredos já configurados. Depois de publicar, abra **Ligar o Google Drive** no painel e autorize a conta da Tia Vanete.

## Endpoints

| Método e caminho                                 | Uso                                                                                               |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `GET /`, `GET /health`                           | Verificam se o serviço está no ar.                                                                |
| `GET /usage`                                     | Mostra o espaço ocupado no R2 e o limite do site.                                                 |
| `PUT ou POST /upload?path=`                      | Envia um arquivo ao R2. Aceita também formulário multipart.                                       |
| `HEAD ou DELETE /object?path=`                   | Consulta ou exclui um arquivo do R2.                                                              |
| `POST /migrate`                                  | Copia arquivos do Supabase para o R2 com o cabeçalho `x-migrate-secret`.                          |
| `GET /google/auth-start`, `GET /google/callback` | Ligam a conta autorizada do Google Drive.                                                         |
| `GET /google/status`                             | Mostra a ligação do Drive e o último lote do backup.                                              |
| `POST /backup/run`                               | Executa um lote agora e informa quantos arquivos foram copiados, falharam ou continuam pendentes. |
| `GET ou POST /drive/folders`                     | Lista ou cria pastas para arquivos pessoais.                                                      |
| `POST /drive/upload-session`                     | Cria a sessão para o navegador enviar o arquivo direto ao Drive.                                  |

As rotas de espaço, upload, exclusão, status, backup manual e arquivos pessoais exigem uma sessão de administrador do Supabase.
