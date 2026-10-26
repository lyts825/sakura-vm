/** 训练材料的明确依赖和线路声明。 */
import {definePlugin,pin} from '../../shared/plugin-protocol.ts';
import {ctrainRoutes,ctrainHttp} from '../../shared/contracts/ctrain-routes.generated.ts';
export const manifest=definePlugin({id:'ctrain-datasets',name:"训练材料",description:"CSV/JSONL 原始字节、列角色和固定样本",category:'development',experimental:true,requires:[pin('ctrain-spaces')],systemDependencies:['classicalTrainingSessions'],services:['ctrainDatasets'],contributes:{http:ctrainHttp('datasets'),routes:ctrainRoutes('datasets')}});
