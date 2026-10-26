/** 训练空间的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {ctrainRoutes,ctrainHttp} from '../../shared/contracts/ctrain-routes.generated.ts';
export const manifest=definePlugin({id:'ctrain-spaces',name:"训练空间",description:"空间、额度、模板及访问修订",category:'development',experimental:true,requires:[],systemDependencies:['classicalTrainingSessions'],services:['ctrainSpaces'],contributes:{http:ctrainHttp('spaces'),routes:ctrainRoutes('spaces')}});
