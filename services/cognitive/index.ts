/**
 * 认知管道（Cognitive Pipeline）
 */

export { type ThinkStage, type StageComposition, STAGE_COMPOSITIONS, STAGE_LABELS, getStageLabels, buildStagesInstruction } from './thinkStages';
export { type CognitiveContext, createCognitiveContext } from './cognitiveContext';
export { type CognitivePromptParams, buildCognitivePrompt } from './cognitivePrompt';
export { type CognitiveOutput, type ConsultOutput, parseCognitiveOutput, parseConsultOutput, applyOutputToContext, EMPTY_COGNITIVE_OUTPUT, EMPTY_CONSULT_OUTPUT } from './cognitiveParser';
export { shouldUseFullCognitive, emotionConsult, type CognitiveCallConfig } from './cognitiveCall';
