// Compatibility facade. Template persistence is owned by the data layer.
export {
  getManagerPrintTemplates,
  getActiveManagerPrintTemplate,
  saveManagerPrintTemplate,
  publishManagerPrintTemplate,
} from './data/repositories/template-repository.js';
