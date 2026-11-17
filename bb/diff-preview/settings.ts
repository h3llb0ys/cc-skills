export const delayOptions = ["250 ms", "500 ms", "800 ms"] as const;
export const placementOptions = ["Over the list", "Above the list"] as const;

export const defaults = {
  enabled: true,
  delay: delayOptions[1],
  placement: placementOptions[0],
  lineNumbers: true,
};
