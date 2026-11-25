import { ClientOnly } from '@tanstack/react-router';
import { Component, Suspense, useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from 'react-aria-components';

import { secondaryButtonClass } from '@/components/styles';
import { useT } from '@/i18n/use-t';

import { EditorFieldPlaceholder } from './editor-field-placeholder';
import type { RetryableLazy } from './retryable-lazy';

/** The props of a lazily loaded field. */
type LazyFieldProps<P extends Readonly<{ label: string }>> = Readonly<{
	/** The field's component and its retry. */
	field: RetryableLazy<P>;
	/** The props of the field. */
	fieldProps: P;
	/** Whether the field has several lines (a text block) or one. */
	multiline: boolean;
}>;

/**
 * What stands in the place of a field whose editor could not be loaded: the label, the message
 * and a button that loads it again. The message is an alert, so it is announced when it appears.
 *
 * @param props The props.
 * @param props.label The visible label of the field.
 * @param props.multiline Whether the field has several lines (a text block) or one.
 * @param props.onRetry Loads the editor again.
 * @returns The error.
 */
function FieldLoadError({
	label,
	multiline,
	onRetry,
}: Readonly<{ label: string; multiline: boolean; onRetry: () => void }>): ReactNode {
	const t = useT();
	return (
		<fieldset className="m-0 flex min-w-0 flex-col gap-1 border-0 p-0">
			<legend className="p-0 font-semibold">{label}</legend>
			<div
				className={`flex flex-wrap items-center gap-3 rounded-md border border-red-700 bg-white px-3 py-2 ${multiline ? 'min-h-24' : 'min-h-10.5'}`}
			>
				<p className="text-red-700" role="alert">
					{t('editor.fieldLoadFailed')}
				</p>
				<Button className={secondaryButtonClass} onPress={onRetry}>
					{t('editor.fieldLoadRetry')}
				</Button>
			</div>
		</fieldset>
	);
}

/** The props of the boundary around a field. */
type BoundaryProps<P extends Readonly<{ label: string }>> = LazyFieldProps<P> &
	Readonly<{
		/** What shows while the field loads. */
		fallback: ReactNode;
		/** Loads the field again. */
		onRetry: () => void;
	}>;

/**
 * Renders a field and catches what it throws, above all a load of its chunk that failed (the
 * network, or a deploy that replaced the chunk): the error shows at the field instead of the
 * error page in place of the whole editor. React has error boundaries as classes only; a retry
 * mounts a new boundary (a new `key`), which renders the field of the new load.
 */
// oxlint-disable-next-line react/prefer-function-component -- an error boundary must be a class
class FieldBoundary<P extends Readonly<{ label: string }>> extends Component<
	BoundaryProps<P>,
	Readonly<{ failed: boolean }>
> {
	/**
	 * Starts without an error.
	 *
	 * @param props The props.
	 */
	public constructor(props: BoundaryProps<P>) {
		super(props);
		this.state = { failed: false };
	}

	/**
	 * Remembers that the field failed.
	 *
	 * @returns The state with the error.
	 */
	public static getDerivedStateFromError(): Readonly<{ failed: boolean }> {
		return { failed: true };
	}

	/**
	 * The field, the placeholder while it loads, or the error.
	 *
	 * @returns The element.
	 */
	public override render(): ReactNode {
		const { fallback, field, fieldProps, multiline, onRetry } = this.props;
		if (this.state.failed) {
			return <FieldLoadError label={fieldProps.label} multiline={multiline} onRetry={onRetry} />;
		}
		const Field = field.current();
		return (
			<Suspense fallback={fallback}>
				<Field {...fieldProps} />
			</Suspense>
		);
	}
}

/**
 * A Tiptap field that loads in the browser only. The server and the first client render show an
 * empty field of the same size; when the load fails, the field shows the error with a button
 * that loads it again, and the rest of the editor stays usable.
 *
 * @param props The props.
 * @param props.field The lazily loaded field.
 * @param props.fieldProps The props of the field.
 * @param props.multiline Whether the field has several lines (a text block) or one.
 * @returns The field.
 */
export function LazyEditorField<P extends Readonly<{ label: string }>>({
	field,
	fieldProps,
	multiline,
}: LazyFieldProps<P>): ReactNode {
	const { label } = fieldProps;
	const [attempt, setAttempt] = useState(0);
	const retry = useCallback(() => {
		field.retry();
		setAttempt((count) => count + 1);
	}, [field]);
	const fallback = useMemo(
		() => <EditorFieldPlaceholder label={label} multiline={multiline} />,
		[label, multiline],
	);
	return (
		<ClientOnly fallback={fallback}>
			<FieldBoundary
				fallback={fallback}
				field={field}
				fieldProps={fieldProps}
				key={attempt}
				multiline={multiline}
				onRetry={retry}
			/>
		</ClientOnly>
	);
}
