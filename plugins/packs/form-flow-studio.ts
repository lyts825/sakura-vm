/** 表单流程工作室的完整成员集合。 */
import {definePack,member} from '../../shared/plugin-protocol.ts';
export const pack=definePack({id:'form-flow-studio',name:"表单流程工作室",description:"表单流程工作室：定义、处理、复核和交接。",members:[member('fform-spaces'),member('fform-fields'),member('fform-schemas'),member('fform-logic'),member('fform-pages'),member('fform-fixtures'),member('fform-validations'),member('fform-previews'),member('fform-submissions'),member('fform-versions'),member('fform-reviews'),member('fform-exchange'),member('fform-workbench')]});
