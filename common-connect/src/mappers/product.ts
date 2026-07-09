import {
  Attribute,
  CategoryReference,
  LocalizedString,
  ProductTypeReference,
} from "@commercetools/platform-sdk";
import {
  CTAkeneoProduct,
  CTAkeneoProductVariant,
} from "../commercetools/api/products";
import { AkeneoProduct, AkeneoProductModel } from "../types/akeneo.types";
import { Config } from "../types/config.types";
import {
  CTAkeneoAttributes,
  CTAkeneoCommonFields,
  mapAttributes,
} from "./attributes";
import { mapCategories } from "./categories";

// Convert an arbitrary string into a commercetools-safe slug segment
// (allowed slug chars are a-z, A-Z, 0-9, "_" and "-").
const slugifyValue = (input: string): string =>
  (input ?? "")
    .toString()
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 200);

// commercetools requires `slug` to be a LocalizedString matching
// ^[A-Za-z0-9_-]+$ and unique across products. The Akeneo attribute mapped to
// slug (often a non-localized identifier) is neither localized nor slug-safe,
// so build a valid slug per locale and append the (unique) sku for uniqueness.
const buildSlug = (
  common: CTAkeneoCommonFields,
  config: Config,
  sku: string
): LocalizedString => {
  const rawSlug: unknown = (common as { slug?: unknown }).slug;
  const name = (common.name && typeof common.name === "object"
    ? common.name
    : {}) as LocalizedString;
  const skuPart = slugifyValue(sku ?? "");

  const locales = Object.keys(name).length
    ? Object.keys(name)
    : Array.from(new Set(Object.values(config.localeMapping)));

  const result: LocalizedString = {};
  for (const loc of locales) {
    let base = "";
    if (rawSlug && typeof rawSlug === "object") {
      base = (rawSlug as Record<string, string>)[loc] ?? "";
    } else if (typeof rawSlug === "string") {
      base = rawSlug;
    }
    if (!base) base = name[loc] ?? "";
    const baseSlug = slugifyValue(base);
    // Append the (unique) sku for uniqueness, unless the base already contains it.
    result[loc] =
      (baseSlug && skuPart && baseSlug.includes(skuPart)
        ? baseSlug
        : slugifyValue(`${baseSlug}-${skuPart}`)) ||
      skuPart ||
      "product";
  }

  if (!Object.keys(result).length) {
    const fallback =
      Array.from(new Set(Object.values(config.localeMapping)))[0] ?? "en";
    result[fallback] = skuPart || "product";
  }

  return result;
};

export const mapProductModel = (
  akeneoProductModel: AkeneoProductModel,
  config: Config
): {
  common: CTAkeneoCommonFields;
  attributes: CTAkeneoAttributes[];
  categories: CategoryReference[];
} => {
  const { common, attributes } = mapAttributes(
    akeneoProductModel.values,
    config,
    config.familyMapping[akeneoProductModel.family]
  );

  return {
    common,
    attributes,
    categories: mapCategories(akeneoProductModel.categories, config),
  };
};

export const mapProduct = (
  akeneoProduct: Omit<AkeneoProduct, "parent"> & {
    parent: AkeneoProductModel | null;
  },
  sku: string,
  config: Config
): CTAkeneoProduct => {
  const familyConfig = config.familyMapping[akeneoProduct.family];

  if (!familyConfig) {
    throw new Error(
      `Family "${akeneoProduct.family}" is not defined in the config.`
    );
  }

  const { common, attributes } = mapAttributes(
    { ...akeneoProduct.parent?.values, ...akeneoProduct.values },
    config,
    familyConfig
  );

  const productDraft = {
    // if there is parent, use the parentCommon, otherwise use the variantCommon
    ...common,
    // Override the raw mapped slug with a valid, unique LocalizedString slug.
    slug: buildSlug(common, config, sku),
    // key: akeneoProduct.parent?.code ?? akeneoProduct.uuid,
    productType: {
      id: familyConfig.commercetoolsProductTypeId,
      typeId: "product-type",
    } as ProductTypeReference,
    categories: mapCategories(akeneoProduct.categories, config),
    masterVariant: {
      sku: sku ?? akeneoProduct.identifier,
      attributes: [
        ...attributes,
        {
          name: "akeneo_id",
          value: akeneoProduct.uuid,
        },
        // if there is no parent, use the uuid as parent code
        {
          name: "akeneo_parent_code",
          value: akeneoProduct.parent?.code ?? akeneoProduct.uuid,
        },
      ],
    },
  };

  return productDraft;
};

export const mapProductVariant = ({
  akeneoProduct,
  sku,
  config,
}: {
  akeneoProduct: Omit<AkeneoProduct, "parent"> & {
    parent: AkeneoProductModel | null;
  };
  sku?: string;
  config: Config;
}): CTAkeneoProductVariant => {
  const familyConfig = config.familyMapping[akeneoProduct.family];

  if (!familyConfig) {
    throw new Error(
      `Family "${akeneoProduct.family}" is not defined in the config.`
    );
  }

  const { attributes } = mapAttributes(
    akeneoProduct.values,
    config,
    familyConfig
  );

  return {
    sku: sku ?? akeneoProduct.identifier,
    attributes: [
      ...attributes,
      {
        name: "akeneo_id",
        value: akeneoProduct.uuid,
      },
      {
        name: "akeneo_parent_code",
        value: akeneoProduct.parent?.code ?? akeneoProduct.uuid,
      },
    ],
  };
};
