/* oxlint-disable typescript/prefer-readonly-parameter-types -- these forward the parameters of the real functions */
/*
 * The template functions of the tests, with the origin of the app filled in: every caller of the
 * real ones must pass it, so the tests say it once here.
 */
import { loadTemplateEditorData as loadEditorData } from './editor-data';
import { checkTemplateForSave as check, prepareTemplateForSave as prepare } from './save-checks';
import {
	createFromStarter as fromStarter,
	createTemplate as create,
	duplicateTemplate as duplicate,
	saveTemplate as save,
} from './templates';

/** The origin of the app in the tests. */
const APP_ORIGIN = 'https://verein.example.org';

const createTemplate = async (
	...args: Parameters<typeof create> extends [...infer Rest, string] ? Rest : never
): ReturnType<typeof create> => create(...args, APP_ORIGIN);
const saveTemplate = async (
	...args: Parameters<typeof save> extends [...infer Rest, string] ? Rest : never
): ReturnType<typeof save> => save(...args, APP_ORIGIN);
const duplicateTemplate = async (
	...args: Parameters<typeof duplicate> extends [...infer Rest, string] ? Rest : never
): ReturnType<typeof duplicate> => duplicate(...args, APP_ORIGIN);
const createFromStarter = async (
	...args: Parameters<typeof fromStarter> extends [...infer Rest, string] ? Rest : never
): ReturnType<typeof fromStarter> => fromStarter(...args, APP_ORIGIN);
const loadTemplateEditorData = async (
	...args: Parameters<typeof loadEditorData> extends [...infer Rest, string] ? Rest : never
): ReturnType<typeof loadEditorData> => loadEditorData(...args, APP_ORIGIN);
const checkTemplateForSave = (
	...args: Parameters<typeof check> extends [...infer Rest, string] ? Rest : never
): ReturnType<typeof check> => check(...args, APP_ORIGIN);
const prepareTemplateForSave = (
	...args: Parameters<typeof prepare> extends [...infer Rest, string] ? Rest : never
): ReturnType<typeof prepare> => prepare(...args, APP_ORIGIN);

export {
	APP_ORIGIN,
	checkTemplateForSave,
	createFromStarter,
	createTemplate,
	duplicateTemplate,
	loadTemplateEditorData,
	prepareTemplateForSave,
	saveTemplate,
};
