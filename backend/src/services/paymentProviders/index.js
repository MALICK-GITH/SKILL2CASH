import { manualPaymentProvider } from './manualPaymentProvider.js';

const providers = [manualPaymentProvider];

export function listPaymentProviders() {
  return providers.map((provider) => ({
    id: provider.id,
    label: provider.label,
    supports: provider.supports
  }));
}

export function listPaymentMethods() {
  return providers.flatMap((provider) => provider.listMethods());
}

export function getPaymentProvider(providerId = 'manual') {
  const provider = providers.find((entry) => entry.id === providerId);
  if (!provider) {
    throw new Error(`Payment provider introuvable: ${providerId}`);
  }
  return provider;
}
