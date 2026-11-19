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

O aviso sai do Gmail do Carlos (**Carloshen.senai@gmail.com**, definido em `ALERT_SENDER_EMAIL`) e chega no Gmail da Tia Vanete (**vanetedeoliveiramaffra@gmail.com**, definido em `ALERT_EMAIL_TO`). O remetente aparece como **Site Tia Vanete <Carloshen.senai@gmail.com>**. O envio usa a API do Gmail com o mesmo cliente OAuth do Google Drive (`GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`), sem nenhum serviço extra e sem custo.

1. No [Google Cloud Console](https://console.cloud.google.com), no projeto **Site Tia Vanete**, abra **APIs e serviços → Biblioteca**, procure **Gmail API** e clique em **Ativar**.
2. Abra **Google Auth Platform → Acesso a dados** (Data Access), clique em **Adicionar ou remover escopos** e marque também `https://www.googleapis.com/auth/gmail.send` (enviar e-mails em seu nome). Salve. Os escopos `openid`, `userinfo.email` e `drive.file` continuam lá.
3. Entre no navegador com a conta **Carloshen.senai@gmail.com** e abra <https://tiavanete-files.carloshen.workers.dev/google/alert-sender/auth-start>.
4. O `gmail.send` é um escopo sensível e o app está publicado sem verificação do Google, então aparece **"O Google não verificou este app"**. Clique em **Avançado → Acessar Site Tia Vanete (não seguro)** e depois em **Permitir** (marque a caixa de enviar e-mails, se ela aparecer).
5. Aparece **Pronto! ✅**. A partir daí, quando houver problema na cópia, a Tia Vanete recebe no máximo um e-mail a cada 24 horas.

O link só aceita a conta definida em `ALERT_SENDER_EMAIL`. A autorização da Tia Vanete para o Drive (`/google/auth-start`) pede só `openid`, `email` e `drive.file`, por isso ela **não** vê o aviso de app não verificado. Os dois fluxos guardam tokens separados no KV (`google:refresh_token` para o Drive dela e `alert_sender:refresh_token` para o Gmail do Carlos).

Se o Carlos trocar a senha do Google ou remover o acesso do app, o painel mostra **Aviso por e-mail desligado** com o link para ligar de novo. Enquanto o Gmail não estiver autorizado, o Worker só registra o problema no log e o aviso vermelho continua aparecendo no painel. Para mandar uma cópia do aviso para outro endereço, preencha `ALERT_CC`.

## Endpoints

| Método e caminho                                 | Uso                                                                                               |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `GET /`, `GET /health`                           | Verificam se o serviço está no ar.                                                                |
| `GET /usage`                                     | Mostra o espaço ocupado no R2 e o limite do site.                                                 |
| `PUT ou POST /upload?path=`                      | Envia um arquivo ao R2. Aceita também formulário multipart.                                       |
| `HEAD ou DELETE /object?path=`                   | Consulta ou exclui um arquivo do R2.                                                              |
| `POST /migrate`                                  | Copia arquivos do Supabase para o R2 com o cabeçalho `x-migrate-secret`.                          |
| `GET /google/auth-start`, `GET /google/callback` | Ligam a conta autorizada do Google Drive.                                                         |
| `GET /google/alert-sender/auth-start`            | Liga o Gmail que envia os avisos (`ALERT_SENDER_EMAIL`). Volta por `/google/callback`.            |
| `GET /google/status`                             | Mostra a ligação do Drive, o último lote do backup e se o aviso por e-mail está ligado.           |
| `POST /backup/run`                               | Executa um lote agora e informa quantos arquivos foram copiados, falharam ou continuam pendentes. |
| `GET ou POST /drive/folders`                     | Lista ou cria pastas para arquivos pessoais.                                                      |
| `POST /drive/upload-session`                     | Cria a sessão para o navegador enviar o arquivo direto ao Drive.                                  |

As rotas de espaço, upload, exclusão, status, backup manual e arquivos pessoais exigem uma sessão de administrador do Supabase.
