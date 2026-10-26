/** 通知模板工作室的完整成员集合。 */
import {definePack,member} from '../../shared/plugin-protocol.ts';
export const pack=definePack({id:'notification-template-studio',name:"通知模板工作室",description:"通知模板工作室：定义、处理、复核和交接。",members:[member('ntpl-spaces'),member('ntpl-variables'),member('ntpl-channels'),member('ntpl-templates'),member('ntpl-locales'),member('ntpl-assets'),member('ntpl-audiences'),member('ntpl-rules'),member('ntpl-renders'),member('ntpl-inboxes'),member('ntpl-checks'),member('ntpl-releases'),member('ntpl-exchange'),member('ntpl-workbench')]});
