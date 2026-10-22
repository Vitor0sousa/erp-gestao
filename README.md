# Hub Estoque — ERP de Gestão

Sistema web para gerenciar produtos, estoque e kits, acompanhar anúncios e resultados financeiros do Mercado Livre e simular preços de venda. Utiliza autenticação pelo Supabase e está hospedado na Vercel.

## Funcionalidades

- **Login:** acesso por e-mail e senha e encerramento de sessão pelo menu lateral.
- **Produtos:** cadastro e edição de SKU, nome, custo, estoque e foto.
- **Kits:** composição com produtos simples, cálculo do custo e disponibilidade conforme os componentes.
- **Anúncios:** consulta, busca e solicitação de sincronização com o Mercado Livre.
- **Financeiro:** filtro por período, faturamento, vendas, custos, taxas, frete, lucro, ticket médio e item mais vendido.
- **Calculadora:** simulação de comissão, frete, lucro e margem para anúncios Clássico e Premium. Os parâmetros são estimativas definidas no código, sem consulta de tarifas em tempo real.
- **Assistente de IA:** geração de rascunhos de anúncios com título, descrição e seleção de imagens, por uma Edge Function.

## Tecnologias

| Camada | Tecnologias |
| --- | --- |
| Interface | Angular 20, TypeScript, componentes standalone, Signals e CSS |
| Navegação | Angular Router |
| Autenticação e banco | Supabase Auth, Postgres e supabase-js |
| Processamento remoto | Supabase Edge Functions |
| Imagens | Cloudinary com upload assinado |
| Hospedagem | Vercel |
| Entrada de servidor | Angular SSR e Express; rotas atualmente em `RenderMode.Client` |
| Testes | Jasmine e Karma |

## Estrutura

```text
api/
  cloudinary-sign.js          # Autoriza uploads de imagens
scripts/
  set-env.js                 # Gera configuração do Angular antes do build
public/                      # Arquivos públicos
src/
  app/
    auth/                    # Guarda de autenticação e testes
    calculadora-precos/      # Simulador de preços e margem
    layout/                  # Estrutura das páginas internas
    pages/
      anuncios/
      assistente/
      dashboard/             # Produtos, estoque e kits
      dashboard-financeiro/
      login/
    shared/sidebar/          # Navegação e logout
    app.routes.ts            # Rotas da aplicação
    app.routes.server.ts     # Estratégia de renderização
  environments/              # Configurações locais/geradas, ignoradas pelo Git
  server.ts                  # Entrada Express/Angular
angular.json                 # Configuração de build e desenvolvimento
```

As implementações das Edge Functions, o esquema SQL e as políticas do banco não estão versionados neste repositório. Para utilizar todas as funcionalidades, é necessário um projeto Supabase com esses recursos configurados.

## Rotas

| Caminho | Página | Acesso |
| --- | --- | --- |
| `/login` | Login | Público |
| `/dashboard` | Produtos e estoque | Autenticado |
| `/anuncios` | Anúncios | Autenticado |
| `/assitente` | Assistente de IA | Autenticado |
| `/financeiro` | Dashboard financeiro | Autenticado |
| `/calculadora` | Calculadora de preços | Autenticado |

A URL `/` redireciona para `/dashboard`. A grafia `/assitente` corresponde à rota atualmente definida no código. O menu também contém um link para `/vinculos`, mas essa rota ainda não está implementada.

As páginas internas usam o `LayoutComponent` e a guarda `canActivateChild`. Antes de liberar cada navegação, a guarda aguarda a validação do usuário com `supabase.auth.getUser()`. Sem autenticação válida ou em caso de falha, o acesso é redirecionado para `/login`.

## Desenvolvimento local

### 1. Instalar dependências

Utilize Node.js e npm compatíveis com Angular 20 e instale as versões do lockfile:

```bash
npm ci
```

No PowerShell, se a política de execução bloquear `npm.ps1`, utilize `npm.cmd` nos comandos.

### 2. Configurar o Angular

Crie `src/environments/environment.ts` e `src/environments/environment.development.ts`. Essa pasta é ignorada pelo Git.

Exemplo para `environment.development.ts`:

```typescript
export const environment = {
  production: false,
  supabaseUrl: 'https://SEU-PROJETO.supabase.co',
  supabaseKey: 'SUA_CHAVE_ANON_PUBLICA',
  cloudinaryCloudName: 'SEU_CLOUD_NAME',
};
```

Para `environment.ts`, utilize a mesma estrutura com `production: true` e os valores correspondentes. O build padrão utiliza esse arquivo; o servidor de desenvolvimento o substitui por `environment.development.ts`, conforme o `angular.json`.

As variáveis configuradas na Vercel não são disponibilizadas automaticamente no computador local. `scripts/set-env.js` gera apenas `environment.ts`, usando variáveis do processo; ele não gera o arquivo de desenvolvimento nem carrega `.env` automaticamente.

### 3. Iniciar a interface

```bash
npm start
```

Acesse `http://localhost:4200` e entre com um usuário existente no Supabase. A interface oferece login, sem tela de cadastro.

O `ng serve` executa a interface, mas não a função `api/cloudinary-sign.js`. Para testar o envio de fotos localmente, o ambiente precisa também servir esse endpoint em `/api/cloudinary-sign`.

## Configuração na Vercel

### Variáveis de ambiente

| Variável | Utilização | Visibilidade |
| --- | --- | --- |
| `SUPABASE_URL` | Cliente Angular e validação de sessão na API | Pública |
| `SUPABASE_ANON_KEY` | Cliente Angular e cliente Supabase da API | Chave pública `anon` |
| `CLOUDINARY_CLOUD_NAME` | Configuração e upload de imagens | Pública |
| `CLOUDINARY_API_KEY` | Identificação do upload assinado | Enviada ao navegador durante o upload |
| `CLOUDINARY_API_SECRET` | Geração da assinatura Cloudinary | Exclusiva do servidor |

O script incorpora ao frontend apenas a URL do Supabase, sua chave pública e o nome do Cloudinary. Nunca utilize uma chave `service_role` ou outro segredo no lugar da chave pública do frontend.

### Build

Como `src/environments/` não é versionado, o ambiente de build precisa gerar `environment.ts` antes de compilar. Para utilizar o script existente, configure o **Build Command** como:

```bash
node scripts/set-env.js && npm run build
```

O `npm run build` atual executa somente `ng build`; não chama o gerador automaticamente. Essa orientação não altera as configurações existentes no painel da Vercel.

Configure as variáveis nos ambientes de publicação correspondentes, como Production e Preview. Alterações nos valores incorporados ao frontend precisam de um novo build.

### Função de `scripts/` e `api/`

**`scripts/set-env.js`** lê as variáveis do processo e escreve o módulo TypeScript importado pelo Angular. Ele é executado durante a preparação do build.

**`api/cloudinary-sign.js`** é o backend para autorizar uploads. Durante o envio de uma foto, o dashboard faz um POST para `/api/cloudinary-sign` com o token da sessão. A função valida esse token no Supabase e retorna assinatura, timestamp e parâmetros públicos do Cloudinary. O navegador envia a imagem diretamente ao Cloudinary e salva a URL no produto. O segredo permanece no servidor.

## Integrações com o Supabase

O frontend utiliza estas tabelas:

| Tabela | Uso |
| --- | --- |
| `produtos_internos` | Cadastro, estoque, custo e busca de produtos |
| `composicao_kits` | Componentes e quantidades dos kits |
| `meli_anuncios` | Dados dos anúncios sincronizados |
| `anuncio_skus` | Associação entre anúncios e produtos |

O dashboard financeiro chama a função SQL `obter_dashboard_financeiro`, passando `data_inicio` e `data_fim`.

Os componentes de anúncios e assistente chamam, respectivamente:

```text
POST {SUPABASE_URL}/functions/v1/meli-sync
POST {SUPABASE_URL}/functions/v1/gerar-anuncio-ia
```

As requisições enviam o token da sessão no header `Authorization`. Os endpoints publicados devem corresponder aos caminhos utilizados pelos componentes. Publicar o frontend na Vercel não publica essas Edge Functions: elas são mantidas no Supabase, com suas próprias configurações e segredos.

## Comandos

| Comando | Descrição |
| --- | --- |
| `npm start` | Servidor de desenvolvimento Angular |
| `npm run build` | Build de produção em `dist/gestao/` |
| `npm run watch` | Build contínuo na configuração de desenvolvimento |
| `npm test` | Testes com Karma/Jasmine |
| `npm run serve:ssr:gestao` | Executa a entrada Node gerada pelo build |

Para executar os testes sem modo de observação, em um ambiente com Chrome instalado:

```bash
npm test -- --watch=false --browsers=ChromeHeadless
```

Os testes de autenticação estão em `src/app/auth/auth.guard.spec.ts`. Cobrem acesso sem sessão, espera pela validação, revalidação entre páginas, falha de conexão e login público. A existência desses testes não significa que a suíte tenha sido executada com sucesso neste checkout.

## Controle de acesso

A guarda controla a navegação da interface. As permissões sobre os dados continuam sendo definidas pelas políticas RLS do Supabase e pela autorização nas funções de backend. O relatório [SECURITY-CHECKUP.md](SECURITY-CHECKUP.md) registra os achados da revisão de segurança e as recomendações de correção.
