interface Attribute {
  id?: string;
  name?: string;
  value_name?: string;
}

interface ListingSkuData {
  seller_custom_field?: string;
  attributes?: Attribute[];
  variations?: Array<{
    id: number | string;
    seller_custom_field?: string;
    attributes?: Attribute[];
    attribute_combinations?: Attribute[];
  }>;
}

function sellerSku({ attributes, seller_custom_field }: ListingSkuData): string | null {
  const value = attributes?.find(attribute => attribute.id === 'SELLER_SKU')?.value_name
    || seller_custom_field;
  return typeof value === 'string' ? value.trim() || null : null;
}

export function marketplaceSkus(item: ListingSkuData) {
  return {
    sku_marketplace: sellerSku(item),
    variacoes_marketplace: (item.variations ?? []).map(variation => ({
      id: String(variation.id),
      sku: sellerSku(variation),
      nome: variation.attribute_combinations?.map(attribute => attribute.value_name).filter(Boolean).join(' · ') || null,
    })),
  };
}
