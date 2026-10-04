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
    let pendingMeasurement = null;
    let holding = false;

    function receive(measurement) {
      if (!isValidMeasurement(measurement)) return false;
      liveMeasurement = { ...measurement };
      if (holding) return false;

      pendingMeasurement = { ...measurement };
      return true;
    }

    function consumeDisplayUpdate() {
      if (pendingMeasurement === null) return null;
      displayMeasurement = pendingMeasurement;
      pendingMeasurement = null;
      return { ...displayMeasurement };
    }

    function toggleHold() {
      if (displayMeasurement === null) {
        return { changed: false, holding };
      }

      holding = !holding;
      // Freeze the value the user has actually seen, even when a newer sensor
      // sample is waiting for the next animation frame.
      pendingMeasurement = holding ? null : { ...liveMeasurement };
      return { changed: true, holding };
    }

    function getLiveMeasurement() {
      return liveMeasurement ? { ...liveMeasurement } : null;
    }

    function getDisplayMeasurement() {
      return displayMeasurement ? { ...displayMeasurement } : null;
    }

    function hasMeasurement() {
      return liveMeasurement !== null;
    }

    function hasDisplayMeasurement() {
      return displayMeasurement !== null;
    }

    function isHolding() {
      return holding;
    }

    function reset() {
      liveMeasurement = null;
      displayMeasurement = null;
      pendingMeasurement = null;
      holding = false;
    }

    return {
      receive,
      consumeDisplayUpdate,
      toggleHold,
      getLiveMeasurement,
      getDisplayMeasurement,
      hasMeasurement,
      hasDisplayMeasurement,
      isHolding,
      reset
    };
  }

  return { create, isValidMeasurement };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = MeasurementState;
}
