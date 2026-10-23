import { RatesEditor } from '../../../RatesEditor';
import { t } from '../../../i18n.ts';
import { SettingsShell } from './Shell';

/** 汇率: the default rate for each currency (a second level under 通用). */
export default function RatesPage() {
  return <SettingsShell title={t('汇率')} lead={t('每个币种新增金额时默认带出的汇率。')}><div className="me-pad"><RatesEditor/></div></SettingsShell>;
}
