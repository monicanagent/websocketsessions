/**
* @file Extensible class intended to (nearly) mimic standard DOM event dispatchers.
*
* @version 0.4.1
*/
/**
* @class Extend this class to enable standard event dispatcher functionality
* in non-native (DOM) objects.
*
* <p><b><i>This class requires ECMAScript 2017 support.</i></b></p>
*
* @example
*
* class myEventDispatcher extends EventDispatcher {
*  constructor() {
*   this.dispatchEvent(new Event("created"));
*  }
* }
*
* @version 0.2.3
* @mixin
* @mixes Object
* @see https://www.w3.org/TR/uievents/
*/
class EventDispatcher {

   constructor () {
       this._registrations = new Object();
   }

   /**
   * Returns all registered listeners for a specific event type.
   *
   * @param {String} type The event type to return registered listeners for.
   *
   * @return {Array} A list of registered event listener objects for the specific event.
   * Each object contains a <code>listener</code> function reference and an
   * execution <code>context</code> reference.
   */
   getListeners (type) {
       if ((this._registrations[type] == undefined) || (this._registrations[type] == null)) {
          this._registrations[type] = new Array();
       }
       return (this._registrations[type]);
   }

   /**
   * Registers a new event listener with the extending class instance.
   *
   * @param {String} type The event type to register.
   * @param {Function} listener The listening function to invoke on the event.
   * @param {Object} [context=null] Unlike the traditional <code>addEventListener</code> parameter, this is
   * the context or scope in which to invoke the listening function (since we can't use capture phases).
   * If null, the listener is invoked in the context of the EventDispatcher or extending instance.
   */
   addEventListener (type, listener, eventContext = null) {
       var listeners = this.getListeners(type);
       var listenerObj = new Object();
       listenerObj.listener = listener;
       listenerObj.context = eventContext;
       listeners.push(listenerObj);
   }

   /**
   * Removes an event listener from the extending instance.
   *
   * @param {String} type The event type to remove the function from.
   * @param {Function} listener The listening function to remove.
   * @param {Object} [context=null] The context or scope in which the listener exists.
   *
   * @augments EventDispatcher
   */
   removeEventListener (type, listener, context=null) {
       var listeners = this.getListeners(type);
       for (var count=0; count < listeners.length; count++) {
          if (context == null) {
             if (listeners[count].listener === listener) {
                listeners.splice(count, 1);
                return;
             }
          } else {
             if ((listeners[count].listener === listener) && (listeners[count].context === context)) {
                listeners.splice(count, 1);
                return;
             }
          }
       }
   }

   dispatchEvent (evt) {
       Object.defineProperty(evt, "target", {writable: true});
       evt.target = this; //typically this is null in custom event instances
       var listeners = Array.from(this.getListeners(evt.type));
       for (var i= 0; i < listeners.length; i++) {
         if (listeners[i].context != null) {
            listeners[i].listener.call(listeners[i].context, evt);
         } else {
            listeners[i].listener.call(this, evt);
         }
       }
       return !evt.defaultPrevented;
   }

   toString() {
      return ("[object EventDispatcher]");
   }
}
