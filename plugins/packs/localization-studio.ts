/** 从固定文案到审阅、语言版本与交接。 */
import { definePack, member } from '../../shared/plugin-protocol.ts';
export const pack = definePack({id:'localization-studio', name:'本地化交付', description:'整理目录和术语，编辑译文、检查与审阅，交付固定语言文件。', members:[member('locale-catalogs'), member('locale-contexts'), member('locale-terminology'), member('locale-translations'), member('locale-checks'), member('locale-previews'), member('locale-reviews'), member('locale-releases'), member('locale-exchange'), member('locale-workbench')]});
