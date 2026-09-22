export { PlanilhaDigitoService } from './planilha-digito.service';
export { EtiquetagemDigitoService } from './etiquetagem-digito.service';
export { digitoConfigStore } from './digito-config-store';
export { validarConfigDigito, chaveConfigDigito } from './digito-config-core';
export {
  CONFIG_PESO_PADRAO, FLAGS, PROVIDENCIAS,
  avaliarProcesso, calcularDiasParados, distribuirPorServidor,
  extrairDigito, metasDoProcesso, montarMapaAtribuicoes,
  ordenarPorDiasParados, selecionarTarefas,
  montarMapaEtiquetas, planejarEtiquetagem,
} from './digito-core';
