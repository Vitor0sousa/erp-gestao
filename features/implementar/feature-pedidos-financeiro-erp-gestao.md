# Feature: pedidos do Mercado Livre no Financeiro — erp-gestao

Data da análise: 22/10/2026

Status: especificação para implementação; nenhuma alteração aplicada no código ou banco.

## 1. Objetivo

Adicionar uma seção **Pedidos do Mercado Livre** na página `/financeiro`, logo abaixo da área de indicadores gerais. Cada pedido deve apresentar foto, título resumido, quantidade, valor vendido, lucro e margem. Um botão à direita abre um pop-up com os itens e a composição financeira completa.

A entrega desta feature inclui leitura dos pedidos, cálculo consistente entre lista e resumo, detalhes financeiros e sinalização de dados ausentes. A primeira versão é de consulta.

## 2. Base analisada

Repositório: [Vitor0sousa/erp-gestao](https://github.com/Vitor0sousa/erp-gestao), branch `main`, referência inspecionada `17b2737ef34db77b6f179df004aad0974ec991e0`.

Arquivos consultados:

- [dashboard-financeiro.ts](https://github.com/Vitor0sousa/erp-gestao/blob/17b2737ef34db77b6f179df004aad0974ec991e0/src/app/pages/dashboard-financeiro/dashboard-financeiro.ts)
- [dashboard-financeiro.html](https://github.com/Vitor0sousa/erp-gestao/blob/17b2737ef34db77b6f179df004aad0974ec991e0/src/app/pages/dashboard-financeiro/dashboard-financeiro.html)
- [dashboard.ts](https://github.com/Vitor0sousa/erp-gestao/blob/17b2737ef34db77b6f179df004aad0974ec991e0/src/app/pages/dashboard/dashboard.ts)
- [calculadora-precos.ts](https://github.com/Vitor0sousa/erp-gestao/blob/17b2737ef34db77b6f179df004aad0974ec991e0/src/app/calculadora-precos/calculadora-precos.ts)
- `app.routes.ts`, `package.json` e `README.md` da mesma referência.

Supabase consultado em modo de leitura:

- Projeto **Gestão**, referência `uvjadekrdvydtorcrhkd`: tabelas do ERP, definição de `obter_dashboard_financeiro`, políticas de pedidos/itens/contas e código publicado das funções `rapid-api` (nome meli-webhook, versão 10) e `sync-vendas` (versão 2).
- Projeto **mcp-mercado_livre**, referência `tpvjqrfrylpezaahzgqd`: inventário de tabelas públicas. As tabelas encontradas são de OAuth do MCP e de clientes; não foram encontradas tabelas de pedidos nesse esquema.

A ligação de produção por variáveis de ambiente não pôde ser confirmada: os arquivos de ambiente não estão versionados. O projeto Gestão contém o modelo e a RPC utilizados pelo frontend, sendo a base compatível identificada nesta análise. Não foram lidos valores de tokens nem dados pessoais de compradores.

## 3. Diagnóstico do estado atual

### Frontend

O ERP usa Angular 20, componentes standalone, Signals e supabase-js. A rota `/financeiro` renderiza `DashboardFinanceiroComponent`.

O Financeiro já possui filtro de período, faturamento bruto, lucro, número de vendas, ticket médio, composição de custos e item mais vendido. Apesar da referência a “gráficos gerais” no pedido, o template atual contém cards e resumo, sem gráficos propriamente ditos.

**Posição proposta:** inserir a lista após o bloco “Composição dos Custos” e antes de “Item Mais Vendido no Período”. Assim, ela aparece imediatamente depois dos indicadores gerais sem eliminar o ranking existente.

### Dados disponíveis

| Origem | Campos úteis existentes | Uso |
| --- | --- | --- |
| pedidos | id, order_id_meli, conta_id, data_venda, status_pedido, valor_total, taxa_ml, custo_frete | Cabeçalho e valores financeiros |
| itens_pedido | pedido_id, anuncio_sku_id, quantidade_vendida | Itens e quantidades |
| anuncio_skus | anuncio_id, variacao_id_meli, produto_interno_id | Vínculo da variação com produto |
| meli_anuncios | item_id_meli, titulo_anuncio, foto_url, preco | Identificação e imagem atuais |
| produtos_internos | sku_interno, nome_produto, tipo, foto_url, custo_unitario | Produto e custo atual |
| composicao_kits | sku_kit_id, sku_simples_id, quantidade_necessaria | Custo dos componentes |
| meli_contas | id, nome_conta, seller_id_meli | Identificação da conta, sem credenciais |

Relação principal: `pedidos → itens_pedido → anuncio_skus → meli_anuncios / produtos_internos`.

### Problemas que afetam a nova tela

1. A RPC atual considera apenas pedidos com `status_pedido = 'paid'`.
2. O custo é calculado por `quantidade_vendida × produtos_internos.custo_unitario`. A RPC não calcula o custo do kit pelos componentes, ao contrário da tela de produtos.
3. O custo atual do cadastro altera o resultado histórico quando o cadastro é atualizado; não existe snapshot de custo nos itens inspecionados.
4. Taxa e frete nulos são convertidos em zero pela RPC. As funções de importação também retornam zero em falhas de consulta do frete. Portanto, zero gravado não comprova custo realmente zero.
5. A consulta agregada encontrou **167 pedidos, 22 sem itens associados, nenhuma taxa nula e nenhum frete nulo**. Esses números representam a consulta realizada, não uma garantia de completude financeira.
6. Nas duas funções inspecionadas, itens sem anúncio/vínculo são ignorados. A busca de vínculo usa apenas anúncio e `.single()`, sem filtrar a variação; anúncios com vários vínculos podem não resolver corretamente.
7. O importador soma `sale_fee` das linhas sem aplicar quantidade. É necessário validar a unidade desse valor com a documentação e exemplos oficiais vigentes antes de alterar a fórmula.
8. O importador histórico só tenta atualizar taxa/frete de pedido existente quando `taxa_ml` está nula; isso não corrige automaticamente frete incorreto ou zero originado de falha.
9. Não foram encontrados nos campos inspecionados preço unitário histórico, título/foto da venda, identificação de envio, pagamentos, descontos detalhados ou estornos.
10. As políticas consultadas para pedidos, itens e contas incluem acesso amplo a `authenticated`. RLS habilitada, por si só, não significa isolamento por conta.

## 4. Experiência da lista

Título: **Pedidos do Mercado Livre**.

Usar o período aplicado no topo do Financeiro. Por padrão, listar pedidos pagos, mantendo o mesmo universo dos indicadores. Filtros opcionais: conta, status e busca por número do pedido, título ou SKU. Ao escolher outro status, deixar explícito que os indicadores principais continuam considerando vendas pagas, ou atualizar ambos por um contrato comum.

| Coluna | Conteúdo |
| --- | --- |
| Produto | Miniatura de 48–56 px, título em até duas linhas e SKU quando disponível |
| Pedido | Número do Mercado Livre, data/hora e status |
| Quantidade | Total de unidades vendidas; mostrar também número de linhas quando houver vários itens |
| Venda | Valor total histórico do pedido |
| Lucro | Valor em reais e indicador de qualidade do cálculo |
| Margem | Percentual calculado sobre a receita |
| Ação | Botão “Ver detalhes”, à direita |

Um pedido ocupa uma linha, independentemente da quantidade de itens. Para vários itens, mostrar o primeiro título e “+ N outros itens”; o pop-up lista todos. A ordenação dos itens deve ser determinística.

Fallback de imagem: foto histórica da venda, quando existir → imagem atual do anúncio → foto do produto → placeholder. Identificar dados atuais usados como fallback. Pedido sem item deve continuar visível com “Produto não identificado”.

Ordenação padrão: data de venda decrescente, com ID como desempate. Paginação no servidor, inicialmente 20 pedidos por página; retornar contagem de pedidos, sem multiplicação por joins.

Estados obrigatórios:

- Carregando, sem pedidos no período e erro com ação para tentar novamente.
- Sem imagem ou vínculo de produto.
- Cálculo incompleto, estimado ou confirmado dentro dos custos cobertos.
- Lucro positivo, negativo ou zero com texto além da cor.

Em telas pequenas, usar cards com a mesma informação principal e botão acessível. Valores monetários em BRL e formatação pt-BR.

## 5. Pop-up de detalhes

O botão abre um modal sobre a página, preservando filtros, página e rolagem da lista.

### Cabeçalho

Número do pedido, conta vendedora, data/hora da venda, status do pedido e qualidade do cálculo.

### Itens vendidos

Foto, título completo, ID do anúncio, variação, SKU interno, quantidade, preço unitário efetivo, total da linha, custo unitário registrado e custo total.

Se o preço histórico não estiver disponível, mostrar “Não disponível”. **Nunca utilizar o preço atual de meli_anuncios como se fosse o preço da venda.**

Para kits, permitir consultar a composição usada no custo. Na ausência de snapshot, indicar que o custo foi estimado pela composição atual.

### Composição financeira

| Campo | Regra |
| --- | --- |
| Valor dos produtos vendidos | Receita histórica documentada |
| Descontos suportados pelo vendedor | Separados, apenas quando não descontados na base de receita |
| Taxas Mercado Livre | Valor efetivo persistido e origem da informação |
| Frete pago pelo vendedor | Parcela do vendedor, sem confundir com frete pago pelo comprador |
| Custo dos produtos | Soma dos custos históricos das linhas, incluindo kits |
| Outros custos e ajustes | Exibir quando houver dados confiáveis e persistidos |
| Lucro da venda | Receita menos deduções cobertas |
| Margem | Lucro dividido pela receita, em percentual |
| Atualização | Data da última sincronização e pendências |

Mostrar pagamentos, situação de recebimento, identificação/status do envio, descontos e estornos quando esses dados forem importados. Campos ausentes devem ser sinalizados; não prometer informações que o esquema atual não armazena.

O valor recebido após taxas e frete é diferente do lucro, pois ainda existe custo do produto. Se exibido, rotular como “Valor após taxas e frete”, sem afirmar liquidação financeira.

### Acessibilidade

Modal com nome acessível, foco inicial, navegação por teclado contida, fechamento por Escape e botão visível de fechar; devolver foco ao botão de origem. Conteúdo longo deve rolar dentro do modal.

## 6. Regras de cálculo

A primeira versão mostra **lucro da venda considerando os custos disponíveis**. Não chamar esse valor de lucro líquido contábil, pois impostos, despesas fixas e outros encargos podem não estar cobertos.

Definir e documentar a semântica de `valor_total`, hoje preenchido com `orderData.total_amount`. A implementação deve conferir se a base já contempla descontos e quais cobranças inclui, evitando desconto duplo.

Para receita V, custo de produtos C, taxa T e frete do vendedor F:

```text
lucro_basico = V - C - T - F
margem_percentual = (lucro_basico / V) × 100, se V > 0
```

Descontos, impostos ou ajustes adicionais só entram uma vez e quando não estiverem incorporados nas parcelas acima. Para receita igual a zero ou negativa, exibir margem “—”.

### Custos dos itens e kits

```text
custo_item_simples = quantidade_vendida × custo_unitario_snapshot

custo_unitario_kit =
  soma(quantidade_necessaria × custo_unitario_snapshot_componente)

custo_item_kit = quantidade_vendida × custo_unitario_kit
custo_pedido = soma(custo_item de todas as linhas)
```

Congelar o custo e a composição usados na venda. Para pedidos antigos sem snapshot, uma reconstrução com cadastro atual deve permanecer identificada como estimativa; não há como garantir custo histórico sem fonte histórica.

### Dados incompletos

- Taxa/frete desconhecidos não equivalem a zero.
- Produto sem vínculo, custo não validado ou item ausente impede lucro confirmado.
- Custo zero só é válido quando conhecido como zero; o default zero do cadastro não comprova isso.
- Sem base mínima confiável, retornar lucro e margem nulos e exibir “Cálculo incompleto”.
- Quando houver estimativa suficiente, apresentar valor como “Estimado” e explicar a origem.
- Mesmo um cálculo confirmado deve informar quais custos cobre.

Exemplo ilustrativo: venda R$ 100,00; custo R$ 40,00; taxa R$ 16,00; frete R$ 12,00. Lucro básico: **R$ 32,00**; margem: **32%**.

### Pedidos especiais

- Cancelados: visíveis no filtro específico e excluídos das métricas de vendas pagas.
- Devolução/estorno parcial ou integral: persistir ajustes e evitar lucro confirmado até reconciliação. Não basta observar apenas o status do pedido.
- Envios compartilhados: persistir identificação do envio e ratear a parcela do vendedor uma única vez. A soma dos rateios deve fechar o total do envio; definir critério, por exemplo proporcional à receita, e ajuste de centavos determinístico.
- Vários itens: agregar primeiro por pedido para não repetir faturamento, taxa ou frete a cada join.
- Variantes: resolver anúncio e variação exatos; não selecionar arbitrariamente o primeiro vínculo.
- Margem do período: soma dos lucros / soma das receitas do mesmo conjunto, nunca média simples das margens.

Usar numeric/decimal ou centavos inteiros para dinheiro. Arredondar de forma consistente, preservando fechamento entre linhas e pedido.

## 7. Proposta técnica

### Leitura e cálculo

Centralizar a regra no backend/Postgres e reutilizá-la na lista, detalhe e resumo. O frontend formata e apresenta os resultados. Não buscar o Mercado Livre diretamente no navegador.

Contratos propostos, ainda inexistentes e sujeitos à implementação:

- `listar_pedidos_financeiro`: período, conta, status, busca e paginação; retorna uma linha por pedido, total e indicadores de completude.
- `obter_pedido_financeiro`: ID do pedido; retorna cabeçalho, itens, composição, ajustes e origens dos valores.
- Adequar `obter_dashboard_financeiro` para consumir a mesma base financeira e informar quantidade de pedidos incompletos/estimados.

Resposta mínima da lista: ID, número ML, conta, data, status, foto/título de resumo, quantidade, número de linhas, receita, custo, taxa, frete, lucro, margem e qualidade do cálculo. Campos financeiros desconhecidos devem aceitar null.

Datas: adotar `America/Sao_Paulo` como fuso de negócio. Converter período inclusivo selecionado para intervalo de timestamps [início do primeiro dia, início do dia seguinte ao último). Usar a mesma regra na lista e nos indicadores. A RPC atual usa cast de timestamp para date, dependente do fuso da sessão.

Ao trocar o filtro, reiniciar a paginação e descartar respostas antigas. Lista e detalhes devem ter estados próprios, permitindo manter os indicadores visíveis quando apenas a listagem falhar.

### Evolução do modelo

Os nomes abaixo são sugestões, não campos existentes.

| Entidade | Evolução sugerida |
| --- | --- |
| pedidos | shipment_id, pack_id, moeda, sincronizado_em, qualidade_financeira e motivos de pendência |
| itens_pedido | identificador estável da linha de origem, item/variação ML, título/foto históricos, preço efetivo, total da linha, custo snapshot e origem/data do custo |
| itens_pedido | permitir preservar item importado mesmo sem vínculo interno; resolver produto posteriormente |
| Snapshot de kit | componentes, quantidades e custos usados no cálculo, em estrutura versionada |
| Taxas/frete | origem, estado de apuração, valor conhecido e data da apuração |
| Ajustes financeiros | descontos, estornos e outros ajustes com identidade de origem e sinal documentado |
| Acesso a contas | vínculo de usuário/perfil com contas permitidas, se houver usuários com escopos distintos |

Antes de definir migrations, conferir constraints e índices existentes. Criar identidade idempotente para linhas que considere pedido, anúncio, variação e identificador de linha quando disponível; não assumir unicidade apenas por anúncio.

Versionar migrations e código das funções alteradas. O README informa que a pasta local supabase é ignorada pelo Git; ajustar seletivamente o versionamento para incluir os arquivos necessários, preservando exclusão de segredos.

### Importação de pedidos

Evoluir `rapid-api` e `sync-vendas` para:

1. Persistir todas as linhas da origem, mesmo sem produto interno identificado.
2. Resolver variações corretamente.
3. Registrar valores efetivos e snapshots com origem.
4. Distinguir falha de consulta de frete de custo zero.
5. Validar semântica de sale_fee, quantidade e frete do vendedor contra documentação oficial e exemplos reais.
6. Atualizar status, taxas, frete e ajustes por reconciliação, sem depender de taxa nula.
7. Reprocessar pedidos de forma idempotente.

**A recuperação financeira de pedidos históricos não deve executar baixa de estoque nem inserir movimentos.** Atualmente o webhook associa inserção de item à baixa; por isso o backfill não deve simplesmente reutilizar esse caminho. Isolar persistência financeira de movimentação de estoque e verificar ausência de efeitos indiretos.

### MCP e ERP

O MCP pode servir à consulta/diagnóstico e a ações autorizadas de reconciliação, mas não precisa estar no caminho de renderização da página. A tela deve consultar o banco do ERP por interface autenticada.

Não duplicar pedidos no projeto do MCP apenas para esta feature. Uma integração entre os projetos exigiria contrato próprio; ela não foi comprovada pela inspeção.

### Controle de acesso

As RPCs devem respeitar o acesso do usuário à conta solicitada. Preferir execução como invocador e políticas compatíveis com o modelo real do ERP; não resolver acesso usando SECURITY DEFINER sem justificativa.

A lista e o detalhe devem retornar campos explícitos, sem select amplo de meli_contas: essa tabela contém access_token e refresh_token. Consultar somente identificação segura da conta, ou uma projeção própria autorizada.

Se o ERP tiver apenas um grupo administrativo com acesso compartilhado, documentar esse modelo. Caso existam usuários com escopos diferentes, substituir políticas amplas por autorização por conta antes de liberar a feature para esses usuários.

## 8. Arquivos previstos para implementação

| Arquivo | Mudança |
| --- | --- |
| src/app/pages/dashboard-financeiro/dashboard-financeiro.ts | Estado de lista, paginação, filtros e modal; chamadas ao serviço |
| src/app/pages/dashboard-financeiro/dashboard-financeiro.html | Lista após custos gerais e acionamento dos detalhes |
| src/app/pages/dashboard-financeiro/dashboard-financeiro.css | Lista responsiva, estados e integração visual |
| src/app/models/pedido-financeiro.ts — novo | Tipos dos contratos e qualidade dos valores |
| src/app/services/financeiro.service.ts — novo | Acesso às consultas financeiras |
| src/app/pages/dashboard-financeiro/components/pedido-detalhes/ — novo | Modal e apresentação da composição |
| Migrations SQL e Edge Functions a versionar | Snapshots, leitura financeira, reconciliação e acesso |
| README.md | Comportamento, custos cobertos e procedimento de sincronização |

Não é necessário criar nova rota: a funcionalidade integra a página /financeiro.

## 9. Sequência de entrega

1. Validar a semântica financeira da origem e o modelo de acesso por conta.
2. Corrigir a importação para preservar itens e marcar pendências.
3. Introduzir snapshots e uma rotina de reconciliação sem efeitos em estoque.
4. Implementar contratos de lista e detalhe com regra financeira compartilhada.
5. Integrar lista e modal no Angular.
6. Alinhar indicadores à mesma base; separar resultados completos e estimados/incompletos.
7. Validar com casos conhecidos e reconciliar o histórico antes de apresentar lucro como confirmado.

Uma entrega inicial pode usar dados atuais com rótulo de estimativa. A exatidão histórica depende da disponibilidade de fontes de custo e dos dados efetivos da venda.

## 10. Critérios de aceite

- [ ] A lista aparece abaixo dos indicadores/custos gerais e antes do item mais vendido.
- [ ] Cada pedido aparece uma única vez, com foto ou placeholder, título resumido, quantidade, venda, lucro e margem.
- [ ] O botão lateral abre os detalhes sem perder filtros ou página.
- [ ] O modal mostra todos os itens e a composição financeira disponível.
- [ ] Pedidos sem itens ou vínculos continuam visíveis e indicam incompletude.
- [ ] Preço atual do anúncio não é exibido como preço histórico.
- [ ] Kits usam composição e quantidades corretas.
- [ ] Alterações de custo não reescrevem resultados com snapshot.
- [ ] Valores desconhecidos não viram zero confirmado.
- [ ] Lista, detalhe e indicadores reconciliam o mesmo conjunto e a mesma regra.
- [ ] Paginação, filtros e datas de limite funcionam no fuso adotado.
- [ ] Cancelamentos, devoluções e fretes compartilhados não geram dupla contagem.
- [ ] A leitura e a reconciliação financeira não alteram estoque.
- [ ] O modal funciona por teclado e em telas pequenas.
- [ ] Acesso direto ao detalhe respeita autorização por conta e nunca retorna tokens.

## 11. Verificação recomendada

| Caso | Resultado esperado |
| --- | --- |
| Venda de 100, custo 40, taxa 16, frete 12 | Lucro 32 e margem 32% |
| Duas unidades de um produto | Custo multiplicado por dois; taxa conforme unidade validada na origem |
| Kit com componentes | Soma dos custos dos componentes × quantidade de kits vendidos |
| Pedido com vários itens | Receita, taxa e frete contados uma vez no pedido |
| Pedido sem itens | Pedido visível; cálculo incompleto |
| Erro ao buscar frete | Estado pendente; não confirmar frete zero |
| Custo alterado após venda | Snapshot da venda permanece estável |
| Receita zero | Margem “—”; sem divisão por zero |
| Pedido com prejuízo | Lucro e margem negativos preservados |
| Dois pedidos no mesmo envio | Rateio fecha o frete total sem duplicar cobrança |
| Reprocessamento financeiro | Sem duplicatas e sem movimentação de estoque |
| Filtro na virada do dia | Lista e resumo incluem exatamente o mesmo período |
| Usuário sem acesso à conta | Lista e detalhe não retornam o pedido |
| Respostas fora de ordem | Filtro mais recente permanece aplicado |

## 12. Limites desta análise

Foi feita análise de código, esquema, função SQL, políticas selecionadas e duas Edge Functions publicadas. Não foram executados importadores, chamadas à API do Mercado Livre, testes de aplicação ou alterações no banco.

A documentação oficial do Mercado Livre não foi consultada nesta etapa; por isso a semântica exata de taxas, descontos e frete permanece como validação obrigatória da implementação. Os pontos sobre sale_fee são riscos observados no código, não uma afirmação de que o valor correto seja sempre unitário ou sempre total.

Esta especificação foi entregue como arquivo separado a pedido do usuário e não foi adicionada ao repositório.
