/**
 * Keeps live sensor measurements separate from the value shown while HOLD is on.
 */
const MeasurementState = (function() {
  function isValidMeasurement(measurement) {
    return Boolean(
      measurement &&
      [measurement.roll, measurement.pitch, measurement.timestamp].every(Number.isFinite)
    );
  }

  function create() {
    let liveMeasurement = null;
    let displayMeasurement = null;
    let holding = false;
    let dirty = false;

    function receive(measurement) {
      if (!isValidMeasurement(measurement)) return false;
      liveMeasurement = { ...measurement };
      if (holding) return false;

      displayMeasurement = { ...measurement };
      dirty = true;
      return true;
    }

    function consumeDisplayUpdate() {
      if (!dirty || displayMeasurement === null) return null;
      dirty = false;
      return { ...displayMeasurement };
    }

    function toggleHold() {
      if (liveMeasurement === null) {
        return { changed: false, holding };
      }

      holding = !holding;
      if (!holding) {
        displayMeasurement = { ...liveMeasurement };
        dirty = true;
      }
      return { changed: true, holding };
    }

    function getLiveMeasurement() {
      return liveMeasurement ? { ...liveMeasurement } : null;
    }

    function hasMeasurement() {
      return liveMeasurement !== null;
    }

    function isHolding() {
      return holding;
    }

    function reset() {
      liveMeasurement = null;
      displayMeasurement = null;
      holding = false;
      dirty = false;
    }

    return {
      receive,
      consumeDisplayUpdate,
      toggleHold,
      getLiveMeasurement,
      hasMeasurement,
      isHolding,
      reset
    };
  }

  return { create, isValidMeasurement };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = MeasurementState;
}
