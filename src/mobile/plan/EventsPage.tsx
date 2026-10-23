import { useState } from "react";
import { useNav } from "../nav-context";
import {
  Button,
  EmptyState,
  ErrorState,
  Icon,
  IconButton,
  Loading,
  NavBar,
} from "../ui";
import { usePlan } from "./data";
import Events from "./Events";
import "./plan.css";
import { t } from '../../i18n.ts';
/** 大额支出: planned big purchases and plans only (as desktop 大额计划). Stage costs live in the budget step, loans in their own page. */
export default function EventsPage() {
  const p = usePlan(),
    nav = useNav(),
    [picker, setPicker] = useState(false);
  const ready = !!p.sources && !!p.saved?.profile.retire.basic;
  return (
    <div className="m-page mp-page">
      <NavBar
        title={t('大额支出')}
        right={
          ready ? (
            <IconButton label={t('添加大额支出')} onClick={() => setPicker(true)}>
              <Icon name="plus" size={22} />
            </IconButton>
          ) : undefined
        }
      />
      {p.loading ? (
        <Loading />
      ) : p.error || !p.sources ? (
        <ErrorState message={p.error} onRetry={p.reload} />
      ) : !p.saved?.profile.retire.basic ? (
        <EmptyState
          icon="chart"
          title={t('先设置一个目标')}
          message={t('设置目标与时间后，才能添加大额支出。')}
          action={
            <Button variant="primary" onClick={() => nav.push("plan.setup")}>
              {t('设置条件')}
            </Button>
          }
        />
      ) : (
        <Events
          sources={p.sources}
          saved={p.saved}
          today={p.today}
          reload={p.reload}
          picker={picker}
          onPicker={setPicker}
        />
      )}
    </div>
  );
}
