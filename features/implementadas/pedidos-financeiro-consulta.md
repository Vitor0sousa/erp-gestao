# Pedidos do Mercado Livre — versão de consulta

Implementação da entrega inicial com dados atuais permitida pela especificação
`features/implementar/feature-pedidos-financeiro-erp-gestao.md`.

## Comportamento entregue

- Lista abaixo dos custos gerais e antes do ranking, com uma linha por pedido.
- Período compartilhado e conta compartilhada com os indicadores; status/busca só na lista.
- Busca por número, título ou SKU, status pago por padrão e 20 pedidos por página.
- Ordenação por data de venda decrescente e ID como desempate; itens ordenados por ID.
- Resumo, lista e detalhe usam a regra em `src/app/models/calculo-financeiro.ts`.
- Consultas diretas ao Supabase em `src/app/services/financeiro.service.ts`, com createClient e environment como nas outras páginas; leituras sujeitas ao RLS vigente.
- Contas consultadas apenas por ID/nome; nenhuma credencial é retornada.
- Modal com itens, custos, valores disponíveis, pendências, Escape, foco contido e retorno de foco.
- Layout em cards em telas pequenas; placeholder também para imagem que falha ao carregar.
- Requisições anteriores canceladas ao trocar filtros; carregamento/erro próprios para resumo/lista/detalhe.
- Datas no fuso America/Sao_Paulo, com fim do período exclusivo no início do dia seguinte.
- Custo pronto de `produtos_internos.custo_unitario` para simples e kits, conforme orientação do usuário.
- Cálculos monetários em centavos; margem ponderada pela receita dos pedidos calculáveis.
- Pedidos sem itens ou custos suficientes continuam na lista com cálculo incompleto.
- Sem uso de preço atual do anúncio para representar preço histórico.

## Limites de dados desta entrega

Nenhum resultado é classificado como confirmado. Os custos são os atuais do cadastro
e mudam quando o cadastro é editado. Custo zero por default e taxa/frete zero sem
apuração confiável impedem calcular lucro. Demais valores são estimativas com
pendências de reconciliação explícitas. A margem é nula para receita zero/negativa.

O valor da receita é o total do pedido já importado; não se deduzem descontos novamente.
O lucro não inclui impostos, despesas fixas ou ajustes desconhecidos. Frete sem identificação
do envio não pode ser rateado/reconciliado: a interface informa essa pendência e não
apresenta o total importado como cobrança confirmada.

Snapshots, preservação de todas as linhas da origem, correção das funções de importação,
reconciliação, devoluções e rateio de fretes compartilhados permanecem como próximas
etapas da especificação completa. Não foram simulados com dados fictícios nem ativados
importadores antigos para recuperar pedidos. O código desta entrega só lê dados.

## Publicação e operação

O serviço utiliza environment.supabaseUrl e environment.supabaseKey. Não exige
SQL, nova coluna, nova RPC ou alteração de política. O modelo de acesso adotado é o
grupo administrativo compartilhado já informado pelo usuário; contas com escopos
distintos exigirão políticas de autorização adequadas antes da ampliação de acesso.

A nova regra substitui o uso da antiga RPC somente nesta página. A RPC existente
permanece disponível a outros consumidores e não foi modificada.

Consultas leem o período em lotes e paginam os resultados na interface. Limites: 367 dias
e 20 mil pedidos/itens por consulta, retornando erro em vez de indicadores truncados.
Para escalar além desses limites, migrar a agregação e a busca para consultas no Postgres.

A implementação anterior, que usava uma API local, foi removida por causar 404 e
divergir do padrão solicitado. O Financeiro agora funciona no fluxo Angular/Supabase
existente, inclusive com `ng serve`, sem um servidor intermediário para as consultas.

Conforme solicitado pelo usuário, não foram executados build nem testes. A revisão
foi estática, com conferência do padrão de consultas e da formatação do diff.
Não houve alteração de banco nem execução de importadores. A entrega deve incluir
esta documentação e o README no mesmo PR do código Angular.
