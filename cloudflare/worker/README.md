# Worker da Tia Vanete

O Worker usa um único arquivo, `worker.js`, sem dependências. O cron roda a cada 10 minutos entre 03h00 e 05h50 (horário de São Paulo), 18 lotes por noite; cada lote copia até cerca de 12 arquivos por causa do limite de 50 chamadas do plano gratuito. A cópia guarda novas versões dos arquivos sem apagar as anteriores. Quando ainda houver pendências, use **Fazer backup agora** no painel para rodar mais um lote.

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

## Pastas e avisos da cópia

No Google Drive, abra **Backup Site Tia Vanete**. Lá ficam as pastas **Mensagens**, **Imagens** e **PDFs**. As capas ficam na pasta **Capas** dentro de cada categoria. A foto do perfil e os arquivos sem material ficam em **Outros**. Se o site ganhar uma nova categoria, ela terá uma pasta com o próprio nome.

Se o Google Drive perder a ligação, ficar sem espaço ou a cópia falhar várias vezes, o painel mostra um aviso com o que fazer. O aviso também aparece quando passam mais de dois dias sem uma cópia bem-sucedida. Com o e-mail ativado, a Tia Vanete recebe até um aviso a cada 24 horas enquanto houver problema. A cópia e os avisos no painel funcionam mesmo sem configurar o e-mail.

### Para o Carlos ativar o e-mail

O aviso por e-mail usa o **Resend**, numa conta só deste projeto. O remetente padrão é **Site Tia Vanete <onboarding@resend.dev>**, o endereço de teste do Resend, que não precisa de domínio. Esse endereço só entrega para o e-mail dono da conta do Resend. Por isso a conta precisa ser criada com o Gmail da Tia Vanete (**vanetedeoliveiramaffra@gmail.com**).

1. Crie uma conta no Resend com o e-mail **vanetedeoliveiramaffra@gmail.com** e confirme o cadastro pelo link que chega nesse Gmail.
2. Nessa conta, crie uma chave de API com permissão **Sending access**.
3. No painel da Cloudflare, abra **Workers & Pages → tiavanete-files → Settings → Variables and Secrets**. Adicione um **Secret** com o nome `RESEND_API_KEY` e cole a chave do Resend. Pelo terminal, no diretório `cloudflare/worker`, use `wrangler secret put RESEND_API_KEY --name tiavanete-files`.
4. Quem recebe é definido em `ALERT_EMAIL_TO` (o Gmail da Tia Vanete). Com o remetente de teste, `ALERT_CC` não funciona, porque o Resend só entrega para o dono da conta.

Se mais tarde a Tia Vanete tiver um domínio próprio, verifique esse domínio no Resend e configure `EMAIL_FROM` com um endereço dele, por exemplo `Site Tia Vanete <avisos@dominio-dela.com.br>`. Assim o aviso pode ir para qualquer destinatário, inclusive a cópia em `ALERT_CC`.

Se preferir o **Cloudflare Email Routing**, ative o serviço no domínio próprio da Tia Vanete. Verifique o e-mail dela como destino e também o seu, se usar `ALERT_CC`. No Worker `tiavanete-files`, adicione um binding **Send Email** com o nome `ALERT_EMAIL` que permita os destinos escolhidos. Configure `EMAIL_FROM` com um endereço desse domínio e mantenha `RESEND_API_KEY` ausente para usar essa opção. O Worker dá preferência ao Resend quando a chave está configurada.

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
