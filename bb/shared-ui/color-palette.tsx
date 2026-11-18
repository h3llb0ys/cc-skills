import React from 'react';

const swatches = ['#808080', '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#8b5cf6', '#ec4899'];

type Props = {
  color: string | null;
  onChange: (color: string | null) => void;
  customColorLabel?: string;
  commitCustomColor?: boolean;
};

type NativePickerProps = {
  color: string;
  label: string;
  onChange: Props['onChange'];
};

class NativeColorPicker extends React.Component<NativePickerProps> {
  private input = React.createRef<HTMLInputElement>();
  private commit = () => this.props.onChange(this.input.current!.value);

  componentDidMount() {
    this.input.current!.addEventListener('change', this.commit);
  }

  componentDidUpdate(previous: NativePickerProps) {
    if (previous.color !== this.props.color) {
      this.input.current!.value = this.props.color;
    }
  }

  componentWillUnmount() {
    this.input.current!.removeEventListener('change', this.commit);
  }

  render() {
    return <input type="color" aria-label={this.props.label}
      defaultValue={this.props.color} ref={this.input} />;
  }
}

export function ColorPalette({
  color,
  onChange,
  customColorLabel = 'Произвольный цвет',
  commitCustomColor = false,
}: Props) {
  const pickerColor = color ?? swatches[0];

  return <div className="cc-color-palette">
    <button className="cc-color-palette-default" type="button" aria-pressed={color === null}
      onClick={() => onChange(null)}>По умолчанию</button>
    {swatches.map(swatch => (
      <button key={swatch} className="cc-color-palette-swatch" type="button" aria-label={swatch}
        aria-pressed={color?.toLowerCase() === swatch} style={{ backgroundColor: swatch }}
        onClick={() => onChange(swatch)} />
    ))}
    <label className="cc-color-palette-custom">
      {commitCustomColor
        ? <NativeColorPicker color={pickerColor} label={customColorLabel} onChange={onChange} />
        : <input type="color" aria-label={customColorLabel} value={pickerColor}
            onChange={event => onChange(event.target.value)} />}
      Свой
    </label>
  </div>;
}
