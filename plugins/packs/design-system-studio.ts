/** 设计系统工作室的完整成员集合。 */
import {definePack,member} from '../../shared/plugin-protocol.ts';
export const pack=definePack({id:'design-system-studio',name:"设计系统工作室",description:"设计系统工作室：定义、处理、复核和交接。",members:[member('dsys-spaces'),member('dsys-tokens'),member('dsys-themes'),member('dsys-typography'),member('dsys-icons'),member('dsys-components'),member('dsys-states'),member('dsys-layouts'),member('dsys-checks'),member('dsys-builds'),member('dsys-reviews'),member('dsys-exchange'),member('dsys-workbench')]});
