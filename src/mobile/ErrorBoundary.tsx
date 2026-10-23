import { Component } from 'react';
import type { ReactNode } from 'react';
import { ErrorState } from './ui';
import { t } from '../i18n.ts';
/** Keeps one broken page from blanking the app; the tab bar and other tabs keep working. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey: unknown }, { error: Error | null; key: unknown }> {
  state = { error: null as Error | null, key: this.props.resetKey };
  static getDerivedStateFromError(error: Error) { return { error }; }
  static getDerivedStateFromProps(props: { resetKey: unknown }, state: { error: Error | null; key: unknown }) { return props.resetKey === state.key ? null : { error: null, key: props.resetKey }; }
  render() {
    return this.state.error ? <ErrorState title={t('这一页打不开')} message={this.state.error.message} onRetry={() => this.setState({ error: null })}/> : this.props.children;
  }
}
