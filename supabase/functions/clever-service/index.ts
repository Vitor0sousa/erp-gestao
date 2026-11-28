import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0"

serve(async (req) => {
  if (Deno.env.get('MELI_PRIVATE_CREDENTIALS_ENABLED') === 'true') {
    return new Response('Inicie a conexão pelo painel Integrações do ERP.', {
      status: 410,
      headers: { 'Cache-Control': 'no-store' },
    })
  }

  try {
    const url = new URL(req.url)
    const code = url.searchParams.get('code')

    if (!code) {
      return new Response("Nenhum código na URL.", { status: 400 })
    }

    // 1. Puxar as chaves secretas e remover espaços invisíveis
    const clientId = Deno.env.get('MELI_CLIENT_ID')?.trim()
    const clientSecret = Deno.env.get('MELI_CLIENT_SECRET')?.trim()

    // URL exata configurada no Mercado Livre Developers
    const redirectUri = "https://uvjadekrdvydtorcrhkd.supabase.co/functions/v1/clever-service"

    if (!clientId || !clientSecret) {
         return new Response("Faltam as chaves secretas no Supabase (MELI_CLIENT_ID ou MELI_CLIENT_SECRET)!", { status: 500 })
    }

    // 2. Fazer a requisição de troca ao Mercado Livre
    const mlResponse = await fetch('https://api.mercadolibre.com/oauth/token', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        code: code,
        redirect_uri: redirectUri
      })
    })

    const mlData = await mlResponse.json()

    // 3. Validação de erro limpa
    if (mlData.error) {
      return new Response(
        `ERRO MERCADO LIVRE: ${mlData.error} - ${mlData.message}. \n\nSe atualizou a página com F5, o código expirou. Feche este separador e gere um link de autorização totalmente novo!`,
        { status: 400 }
      )
    }

    // 4. Inicializar o cliente do Supabase com a chave service_role (ignora o RLS)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const supabase = createClient(supabaseUrl!, supabaseKey!)

    // 5. Inserir ou atualizar os dados na tabela meli_contas
    const { data, error } = await supabase
      .from('meli_contas')
      .upsert({
        seller_id_meli: mlData.user_id.toString(),
        access_token: mlData.access_token,
        refresh_token: mlData.refresh_token,
        nome_conta: `Conta ML ${mlData.user_id}`
      }, { onConflict: 'seller_id_meli' })

    if (error) {
      return new Response(`Erro na Base de Dados: ${error.message}`, { status: 500 })
    }

    // 6. Resposta visual de sucesso
    const htmlSucesso = `
      <html>
        <body style="font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background-color: #f0fdf4; text-align: center;">
          <h1 style="color: #15803d; font-size: 2.5rem; margin-bottom: 10px;">Conectado com Sucesso!</h1>
          <p style="color: #166534; font-size: 1.2rem;">O seu sistema de stock agora está integrado com o Mercado Livre.</p>
          <p style="color: #666;">Os tokens de acesso foram gerados e guardados na tabela <b>meli_contas</b>.</p>
          <p style="margin-top: 20px; color: #888; font-size: 0.9rem;">Pode fechar este separador em segurança.</p>
        </body>
      </html>
    `
    return new Response(htmlSucesso, { headers: { "Content-Type": "text/html" } })

  } catch (err: any) {
    return new Response(`Erro Interno no Servidor: ${err.message}`, { status: 500 })
  }
})
