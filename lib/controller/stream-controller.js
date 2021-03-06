'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _binarySearch = require('../utils/binary-search');

var _binarySearch2 = _interopRequireDefault(_binarySearch);

var _bufferHelper = require('../helper/buffer-helper');

var _bufferHelper2 = _interopRequireDefault(_bufferHelper);

var _demuxer = require('../demux/demuxer');

var _demuxer2 = _interopRequireDefault(_demuxer);

var _events = require('../events');

var _events2 = _interopRequireDefault(_events);

var _eventHandler = require('../event-handler');

var _eventHandler2 = _interopRequireDefault(_eventHandler);

var _levelHelper = require('../helper/level-helper');

var _levelHelper2 = _interopRequireDefault(_levelHelper);

var _timeRanges = require('../utils/timeRanges');

var _timeRanges2 = _interopRequireDefault(_timeRanges);

var _errors = require('../errors');

var _logger = require('../utils/logger');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; } /*
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                * Stream Controller
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               */

var State = {
  STOPPED: 'STOPPED',
  IDLE: 'IDLE',
  KEY_LOADING: 'KEY_LOADING',
  FRAG_LOADING: 'FRAG_LOADING',
  FRAG_LOADING_WAITING_RETRY: 'FRAG_LOADING_WAITING_RETRY',
  WAITING_LEVEL: 'WAITING_LEVEL',
  PARSING: 'PARSING',
  PARSED: 'PARSED',
  BUFFER_FLUSHING: 'BUFFER_FLUSHING',
  ENDED: 'ENDED',
  ERROR: 'ERROR'
};

var StreamController = function (_EventHandler) {
  _inherits(StreamController, _EventHandler);

  function StreamController(hls) {
    _classCallCheck(this, StreamController);

    var _this = _possibleConstructorReturn(this, (StreamController.__proto__ || Object.getPrototypeOf(StreamController)).call(this, hls, _events2.default.MEDIA_ATTACHED, _events2.default.MEDIA_DETACHING, _events2.default.MANIFEST_LOADING, _events2.default.MANIFEST_PARSED, _events2.default.LEVEL_LOADED, _events2.default.KEY_LOADED, _events2.default.FRAG_LOADED, _events2.default.FRAG_LOAD_EMERGENCY_ABORTED, _events2.default.FRAG_PARSING_INIT_SEGMENT, _events2.default.FRAG_PARSING_DATA, _events2.default.FRAG_PARSED, _events2.default.ERROR, _events2.default.AUDIO_TRACK_SWITCHING, _events2.default.AUDIO_TRACK_SWITCHED, _events2.default.BUFFER_CREATED, _events2.default.BUFFER_APPENDED, _events2.default.BUFFER_FLUSHED));

    _this.config = hls.config;
    _this.audioCodecSwap = false;
    _this.ticks = 0;
    _this._state = State.STOPPED;
    _this.ontick = _this.tick.bind(_this);
    return _this;
  }

  _createClass(StreamController, [{
    key: 'destroy',
    value: function destroy() {
      this.stopLoad();
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
      _eventHandler2.default.prototype.destroy.call(this);
      this.state = State.STOPPED;
    }
  }, {
    key: 'startLoad',
    value: function startLoad(startPosition) {
      if (this.levels) {
        var lastCurrentTime = this.lastCurrentTime,
            hls = this.hls;
        this.stopLoad();
        if (!this.timer) {
          this.timer = setInterval(this.ontick, 100);
        }
        this.level = -1;
        this.fragLoadError = 0;
        if (!this.startFragRequested) {
          // determine load level
          var startLevel = hls.startLevel;
          if (startLevel === -1) {
            // -1 : guess start Level by doing a bitrate test by loading first fragment of lowest quality level
            startLevel = 0;
            this.bitrateTest = true;
          }
          // set new level to playlist loader : this will trigger start level load
          // hls.nextLoadLevel remains until it is set to a new value or until a new frag is successfully loaded
          this.level = hls.nextLoadLevel = startLevel;
          this.loadedmetadata = false;
        }
        // if startPosition undefined but lastCurrentTime set, set startPosition to last currentTime
        if (lastCurrentTime > 0 && startPosition === -1) {
          _logger.logger.log('override startPosition with lastCurrentTime @' + lastCurrentTime.toFixed(3));
          startPosition = lastCurrentTime;
        }
        this.state = State.IDLE;
        this.nextLoadPosition = this.startPosition = this.lastCurrentTime = startPosition;
        this.tick();
      } else {
        _logger.logger.warn('cannot start loading as manifest not parsed yet');
        this.state = State.STOPPED;
      }
    }
  }, {
    key: 'stopLoad',
    value: function stopLoad() {
      var frag = this.fragCurrent;
      if (frag) {
        if (frag.loader) {
          frag.loader.abort();
        }
        this.fragCurrent = null;
      }
      this.fragPrevious = null;
      if (this.demuxer) {
        this.demuxer.destroy();
        this.demuxer = null;
      }
      this.state = State.STOPPED;
    }
  }, {
    key: 'tick',
    value: function tick() {
      this.ticks++;
      if (this.ticks === 1) {
        this.doTick();
        if (this.ticks > 1) {
          setTimeout(this.tick, 1);
        }
        this.ticks = 0;
      }
    }
  }, {
    key: 'doTick',
    value: function doTick() {
      switch (this.state) {
        case State.ERROR:
          //don't do anything in error state to avoid breaking further ...
          break;
        case State.BUFFER_FLUSHING:
          // in buffer flushing state, reset fragLoadError counter
          this.fragLoadError = 0;
          break;
        case State.IDLE:
          // when this returns false there was an error and we shall return immediatly
          // from current tick
          if (!this._doTickIdle()) {
            return;
          }
          break;
        case State.WAITING_LEVEL:
          var level = this.levels[this.level];
          // check if playlist is already loaded
          if (level && level.details) {
            this.state = State.IDLE;
          }
          break;
        case State.FRAG_LOADING_WAITING_RETRY:
          var now = performance.now();
          var retryDate = this.retryDate;
          // if current time is gt than retryDate, or if media seeking let's switch to IDLE state to retry loading
          if (!retryDate || now >= retryDate || this.media && this.media.seeking) {
            _logger.logger.log('mediaController: retryDate reached, switch back to IDLE state');
            this.state = State.IDLE;
          }
          break;
        case State.ERROR:
        case State.STOPPED:
        case State.FRAG_LOADING:
        case State.PARSING:
        case State.PARSED:
        case State.ENDED:
          break;
        default:
          break;
      }
      // check buffer
      this._checkBuffer();
      // check/update current fragment
      this._checkFragmentChanged();
    }

    // Ironically the "idle" state is the on we do the most logic in it seems ....
    // NOTE: Maybe we could rather schedule a check for buffer length after half of the currently
    //       played segment, or on pause/play/seek instead of naively checking every 100ms?

  }, {
    key: '_doTickIdle',
    value: function _doTickIdle() {
      var hls = this.hls,
          config = hls.config,
          media = this.media;

      // if video not attached AND
      // start fragment already requested OR start frag prefetch disable
      // exit loop
      // => if start level loaded and media not attached but start frag prefetch is enabled and start frag not requested yet, we will not exit loop
      if (this.levelLastLoaded !== undefined && !media && (this.startFragRequested || !config.startFragPrefetch)) {
        return true;
      }

      // if we have not yet loaded any fragment, start loading from start position
      var pos = void 0;
      if (this.loadedmetadata) {
        pos = media.currentTime;
      } else {
        pos = this.nextLoadPosition;
      }
      // determine next load level
      var level = hls.nextLoadLevel,
          levelInfo = this.levels[level],
          levelBitrate = levelInfo.bitrate,
          maxBufLen = void 0;

      // compute max Buffer Length that we could get from this load level, based on level bitrate. don't buffer more than 60 MB and more than 30s
      if (levelBitrate) {
        maxBufLen = Math.max(8 * config.maxBufferSize / levelBitrate, config.maxBufferLength);
      } else {
        maxBufLen = config.maxBufferLength;
      }
      maxBufLen = Math.min(maxBufLen, config.maxMaxBufferLength);

      // determine next candidate fragment to be loaded, based on current position and end of buffer position
      // ensure up to `config.maxMaxBufferLength` of buffer upfront

      var bufferInfo = _bufferHelper2.default.bufferInfo(this.mediaBuffer ? this.mediaBuffer : media, pos, config.maxBufferHole),
          bufferLen = bufferInfo.len;
      // Stay idle if we are still with buffer margins
      if (bufferLen >= maxBufLen) {
        return true;
      }

      // if buffer length is less than maxBufLen try to load a new fragment ...
      _logger.logger.trace('buffer length of ' + bufferLen.toFixed(3) + ' is below max of ' + maxBufLen.toFixed(3) + '. checking for more payload ...');

      // set next load level : this will trigger a playlist load if needed
      this.level = hls.nextLoadLevel = level;

      var levelDetails = levelInfo.details;
      // if level info not retrieved yet, switch state and wait for level retrieval
      // if live playlist, ensure that new playlist has been refreshed to avoid loading/try to load
      // a useless and outdated fragment (that might even introduce load error if it is already out of the live playlist)
      if (typeof levelDetails === 'undefined' || levelDetails.live && this.levelLastLoaded !== level) {
        this.state = State.WAITING_LEVEL;
        return true;
      }

      // we just got done loading the final fragment, check if we need to finalize media stream
      var fragPrevious = this.fragPrevious;
      if (!levelDetails.live && fragPrevious && fragPrevious.sn === levelDetails.endSN) {
        // fragPrevious is last fragment. retrieve level duration using last frag start offset + duration
        // real duration might be lower than initial duration if there are drifts between real frag duration and playlist signaling
        var duration = Math.min(media.duration, fragPrevious.start + fragPrevious.duration);
        // if everything (almost) til the end is buffered, let's signal eos
        // we don't compare exactly media.duration === bufferInfo.end as there could be some subtle media duration difference
        // using half frag duration should help cope with these cases.
        // also cope with almost zero last frag duration (max last frag duration with 200ms) refer to https://github.com/video-dev/hls.js/pull/657
        if (duration - Math.max(bufferInfo.end, fragPrevious.start) <= Math.max(0.2, fragPrevious.duration / 2)) {
          // Finalize the media stream
          var data = {};
          if (this.altAudio) {
            data.type = 'video';
          }
          this.hls.trigger(_events2.default.BUFFER_EOS, data);
          this.state = State.ENDED;
          return true;
        }
      }

      // if we have the levelDetails for the selected variant, lets continue enrichen our stream (load keys/fragments or trigger EOS, etc..)
      return this._fetchPayloadOrEos(pos, bufferInfo, levelDetails);
    }
  }, {
    key: '_fetchPayloadOrEos',
    value: function _fetchPayloadOrEos(pos, bufferInfo, levelDetails) {
      var fragPrevious = this.fragPrevious,
          level = this.level,
          fragments = levelDetails.fragments,
          fragLen = fragments.length;

      // empty playlist
      if (fragLen === 0) {
        return false;
      }

      // find fragment index, contiguous with end of buffer position
      var start = fragments[0].start,
          end = fragments[fragLen - 1].start + fragments[fragLen - 1].duration,
          bufferEnd = bufferInfo.end,
          frag = void 0;

      if (levelDetails.initSegment && !levelDetails.initSegment.data) {
        frag = levelDetails.initSegment;
      } else {
        // in case of live playlist we need to ensure that requested position is not located before playlist start
        if (levelDetails.live) {
          var initialLiveManifestSize = this.config.initialLiveManifestSize;
          if (fragLen < initialLiveManifestSize) {
            _logger.logger.warn('Can not start playback of a level, reason: not enough fragments ' + fragLen + ' < ' + initialLiveManifestSize);
            return false;
          }

          frag = this._ensureFragmentAtLivePoint(levelDetails, bufferEnd, start, end, fragPrevious, fragments, fragLen);
          // if it explicitely returns null don't load any fragment and exit function now
          if (frag === null) {
            return false;
          }
        } else {
          // VoD playlist: if bufferEnd before start of playlist, load first fragment
          if (bufferEnd < start) {
            frag = fragments[0];
          }
        }
      }
      if (!frag) {
        frag = this._findFragment(start, fragPrevious, fragLen, fragments, bufferEnd, end, levelDetails);
      }
      if (frag) {
        return this._loadFragmentOrKey(frag, level, levelDetails, pos, bufferEnd);
      }
      return true;
    }
  }, {
    key: '_ensureFragmentAtLivePoint',
    value: function _ensureFragmentAtLivePoint(levelDetails, bufferEnd, start, end, fragPrevious, fragments, fragLen) {
      var config = this.hls.config,
          media = this.media;

      var frag = void 0;

      // check if requested position is within seekable boundaries :
      //logger.log(`start/pos/bufEnd/seeking:${start.toFixed(3)}/${pos.toFixed(3)}/${bufferEnd.toFixed(3)}/${this.media.seeking}`);
      var maxLatency = config.liveMaxLatencyDuration !== undefined ? config.liveMaxLatencyDuration : config.liveMaxLatencyDurationCount * levelDetails.targetduration;

      if (bufferEnd < Math.max(start - config.maxFragLookUpTolerance, end - maxLatency)) {
        var liveSyncPosition = this.liveSyncPosition = this.computeLivePosition(start, levelDetails);
        _logger.logger.log('buffer end: ' + bufferEnd.toFixed(3) + ' is located too far from the end of live sliding playlist, reset currentTime to : ' + liveSyncPosition.toFixed(3));
        bufferEnd = liveSyncPosition;
        if (media && media.readyState && media.duration > liveSyncPosition) {
          media.currentTime = liveSyncPosition;
        }
      }

      // if end of buffer greater than live edge, don't load any fragment
      // this could happen if live playlist intermittently slides in the past.
      // level 1 loaded [182580161,182580167]
      // level 1 loaded [182580162,182580169]
      // Loading 182580168 of [182580162 ,182580169],level 1 ..
      // Loading 182580169 of [182580162 ,182580169],level 1 ..
      // level 1 loaded [182580162,182580168] <============= here we should have bufferEnd > end. in that case break to avoid reloading 182580168
      // level 1 loaded [182580164,182580171]
      //
      // don't return null in case media not loaded yet (readystate === 0)
      if (levelDetails.PTSKnown && bufferEnd > end && media && media.readyState) {
        return null;
      }

      if (this.startFragRequested && !levelDetails.PTSKnown) {
        /* we are switching level on live playlist, but we don't have any PTS info for that quality level ...
           try to load frag matching with next SN.
           even if SN are not synchronized between playlists, loading this frag will help us
           compute playlist sliding and find the right one after in case it was not the right consecutive one */
        if (fragPrevious) {
          var targetSN = fragPrevious.sn + 1;
          if (targetSN >= levelDetails.startSN && targetSN <= levelDetails.endSN) {
            frag = fragments[targetSN - levelDetails.startSN];
            _logger.logger.log('live playlist, switching playlist, load frag with next SN: ' + frag.sn);
          }
        }
        if (!frag) {
          /* we have no idea about which fragment should be loaded.
             so let's load mid fragment. it will help computing playlist sliding and find the right one
          */
          frag = fragments[Math.min(fragLen - 1, Math.round(fragLen / 2))];
          _logger.logger.log('live playlist, switching playlist, unknown, load middle frag : ' + frag.sn);
        }
      }
      return frag;
    }
  }, {
    key: '_findFragment',
    value: function _findFragment(start, fragPrevious, fragLen, fragments, bufferEnd, end, levelDetails) {
      var config = this.hls.config;
      var frag = void 0;
      var foundFrag = void 0;
      var maxFragLookUpTolerance = config.maxFragLookUpTolerance;
      var fragNext = fragPrevious ? fragments[fragPrevious.sn - fragments[0].sn + 1] : undefined;
      var fragmentWithinToleranceTest = function fragmentWithinToleranceTest(candidate) {
        // offset should be within fragment boundary - config.maxFragLookUpTolerance
        // this is to cope with situations like
        // bufferEnd = 9.991
        // frag[Ø] : [0,10]
        // frag[1] : [10,20]
        // bufferEnd is within frag[0] range ... although what we are expecting is to return frag[1] here
        //              frag start               frag start+duration
        //                  |-----------------------------|
        //              <--->                         <--->
        //  ...--------><-----------------------------><---------....
        // previous frag         matching fragment         next frag
        //  return -1             return 0                 return 1
        //logger.log(`level/sn/start/end/bufEnd:${level}/${candidate.sn}/${candidate.start}/${(candidate.start+candidate.duration)}/${bufferEnd}`);
        // Set the lookup tolerance to be small enough to detect the current segment - ensures we don't skip over very small segments
        var candidateLookupTolerance = Math.min(maxFragLookUpTolerance, candidate.duration);
        if (candidate.start + candidate.duration - candidateLookupTolerance <= bufferEnd) {
          return 1;
        } // if maxFragLookUpTolerance will have negative value then don't return -1 for first element
        else if (candidate.start - candidateLookupTolerance > bufferEnd && candidate.start) {
            return -1;
          }
        return 0;
      };

      if (bufferEnd < end) {
        if (bufferEnd > end - maxFragLookUpTolerance) {
          maxFragLookUpTolerance = 0;
        }
        // Prefer the next fragment if it's within tolerance
        if (fragNext && !fragmentWithinToleranceTest(fragNext)) {
          foundFrag = fragNext;
        } else {
          foundFrag = _binarySearch2.default.search(fragments, fragmentWithinToleranceTest);
        }
      } else {
        // reach end of playlist
        foundFrag = fragments[fragLen - 1];
      }
      if (foundFrag) {
        frag = foundFrag;
        var curSNIdx = frag.sn - levelDetails.startSN;
        var sameLevel = fragPrevious && frag.level === fragPrevious.level;
        var prevFrag = fragments[curSNIdx - 1];
        var nextFrag = fragments[curSNIdx + 1];
        //logger.log('find SN matching with pos:' +  bufferEnd + ':' + frag.sn);
        if (sameLevel && frag.sn === fragPrevious.sn) {
          if (frag.sn < levelDetails.endSN) {
            var deltaPTS = fragPrevious.deltaPTS;
            // if there is a significant delta between audio and video, larger than max allowed hole,
            // and if previous remuxed fragment did not start with a keyframe. (fragPrevious.dropped)
            // let's try to load previous fragment again to get last keyframe
            // then we will reload again current fragment (that way we should be able to fill the buffer hole ...)
            if (deltaPTS && deltaPTS > config.maxBufferHole && fragPrevious.dropped && curSNIdx) {
              frag = prevFrag;
              _logger.logger.warn('SN just loaded, with large PTS gap between audio and video, maybe frag is not starting with a keyframe ? load previous one to try to overcome this');
              // decrement previous frag load counter to avoid frag loop loading error when next fragment will get reloaded
              fragPrevious.loadCounter--;
            } else {
              frag = nextFrag;
              _logger.logger.log('SN just loaded, load next one: ' + frag.sn);
            }
          } else {
            frag = null;
          }
        } else if (frag.dropped && !sameLevel) {
          // Only backtrack a max of 1 consecutive fragment to prevent sliding back too far when little or no frags start with keyframes
          if (nextFrag && nextFrag.backtracked) {
            _logger.logger.warn('Already backtracked from fragment ' + (curSNIdx + 1) + ', will not backtrack to fragment ' + curSNIdx + '. Loading fragment ' + (curSNIdx + 1));
            frag = nextFrag;
          } else {
            // If a fragment has dropped frames and it's in a different level/sequence, load the previous fragment to try and find the keyframe
            // Reset the dropped count now since it won't be reset until we parse the fragment again, which prevents infinite backtracking on the same segment
            _logger.logger.warn('Loaded fragment with dropped frames, backtracking 1 segment to find a keyframe');
            frag.dropped = 0;
            if (prevFrag) {
              if (prevFrag.loadCounter) {
                prevFrag.loadCounter--;
              }
              frag = prevFrag;
            } else {
              frag = null;
            }
          }
        }
      }
      return frag;
    }
  }, {
    key: '_loadFragmentOrKey',
    value: function _loadFragmentOrKey(frag, level, levelDetails, pos, bufferEnd) {
      var hls = this.hls,
          config = hls.config;

      //logger.log('loading frag ' + i +',pos/bufEnd:' + pos.toFixed(3) + '/' + bufferEnd.toFixed(3));
      if (frag.decryptdata && frag.decryptdata.uri != null && frag.decryptdata.key == null) {
        _logger.logger.log('Loading key for ' + frag.sn + ' of [' + levelDetails.startSN + ' ,' + levelDetails.endSN + '],level ' + level);
        this.state = State.KEY_LOADING;
        hls.trigger(_events2.default.KEY_LOADING, { frag: frag });
      } else {
        _logger.logger.log('Loading ' + frag.sn + ' of [' + levelDetails.startSN + ' ,' + levelDetails.endSN + '],level ' + level + ', currentTime:' + pos.toFixed(3) + ',bufferEnd:' + bufferEnd.toFixed(3));
        // ensure that we are not reloading the same fragments in loop ...
        if (this.fragLoadIdx !== undefined) {
          this.fragLoadIdx++;
        } else {
          this.fragLoadIdx = 0;
        }
        if (frag.loadCounter) {
          frag.loadCounter++;
          var maxThreshold = config.fragLoadingLoopThreshold;
          // if this frag has already been loaded 3 times, and if it has been reloaded recently
          if (frag.loadCounter > maxThreshold && Math.abs(this.fragLoadIdx - frag.loadIdx) < maxThreshold) {
            hls.trigger(_events2.default.ERROR, { type: _errors.ErrorTypes.MEDIA_ERROR, details: _errors.ErrorDetails.FRAG_LOOP_LOADING_ERROR, fatal: false, frag: frag });
            return false;
          }
        } else {
          frag.loadCounter = 1;
        }
        frag.loadIdx = this.fragLoadIdx;
        this.fragCurrent = frag;
        this.startFragRequested = true;
        if (!isNaN(frag.sn)) {
          this.nextLoadPosition = frag.start + frag.duration;
        }
        frag.autoLevel = hls.autoLevelEnabled;
        frag.bitrateTest = this.bitrateTest;
        hls.trigger(_events2.default.FRAG_LOADING, { frag: frag });
        // lazy demuxer init, as this could take some time ... do it during frag loading
        if (!this.demuxer) {
          this.demuxer = new _demuxer2.default(hls, 'main');
        }
        this.state = State.FRAG_LOADING;
        return true;
      }
    }
  }, {
    key: 'getBufferedFrag',
    value: function getBufferedFrag(position) {
      return _binarySearch2.default.search(this._bufferedFrags, function (frag) {
        if (position < frag.startPTS) {
          return -1;
        } else if (position > frag.endPTS) {
          return 1;
        }
        return 0;
      });
    }
  }, {
    key: 'followingBufferedFrag',
    value: function followingBufferedFrag(frag) {
      if (frag) {
        // try to get range of next fragment (500ms after this range)
        return this.getBufferedFrag(frag.endPTS + 0.5);
      }
      return null;
    }
  }, {
    key: '_checkFragmentChanged',
    value: function _checkFragmentChanged() {
      var fragPlayingCurrent,
          currentTime,
          video = this.media;
      if (video && video.readyState && video.seeking === false) {
        currentTime = video.currentTime;
        /* if video element is in seeked state, currentTime can only increase.
          (assuming that playback rate is positive ...)
          As sometimes currentTime jumps back to zero after a
          media decode error, check this, to avoid seeking back to
          wrong position after a media decode error
        */
        if (currentTime > video.playbackRate * this.lastCurrentTime) {
          this.lastCurrentTime = currentTime;
        }
        if (_bufferHelper2.default.isBuffered(video, currentTime)) {
          fragPlayingCurrent = this.getBufferedFrag(currentTime);
        } else if (_bufferHelper2.default.isBuffered(video, currentTime + 0.1)) {
          /* ensure that FRAG_CHANGED event is triggered at startup,
            when first video frame is displayed and playback is paused.
            add a tolerance of 100ms, in case current position is not buffered,
            check if current pos+100ms is buffered and use that buffer range
            for FRAG_CHANGED event reporting */
          fragPlayingCurrent = this.getBufferedFrag(currentTime + 0.1);
        }
        if (fragPlayingCurrent) {
          var fragPlaying = fragPlayingCurrent;
          if (fragPlaying !== this.fragPlaying) {
            this.hls.trigger(_events2.default.FRAG_CHANGED, { frag: fragPlaying });
            var fragPlayingLevel = fragPlaying.level;
            if (!this.fragPlaying || this.fragPlaying.level !== fragPlayingLevel) {
              this.hls.trigger(_events2.default.LEVEL_SWITCHED, { level: fragPlayingLevel });
            }
            this.fragPlaying = fragPlaying;
          }
        }
      }
    }

    /*
      on immediate level switch :
       - pause playback if playing
       - cancel any pending load request
       - and trigger a buffer flush
    */

  }, {
    key: 'immediateLevelSwitch',
    value: function immediateLevelSwitch() {
      _logger.logger.log('immediateLevelSwitch');
      if (!this.immediateSwitch) {
        this.immediateSwitch = true;
        var media = this.media,
            previouslyPaused = void 0;
        if (media) {
          previouslyPaused = media.paused;
          media.pause();
        } else {
          // don't restart playback after instant level switch in case media not attached
          previouslyPaused = true;
        }
        this.previouslyPaused = previouslyPaused;
      }
      var fragCurrent = this.fragCurrent;
      if (fragCurrent && fragCurrent.loader) {
        fragCurrent.loader.abort();
      }
      this.fragCurrent = null;
      // increase fragment load Index to avoid frag loop loading error after buffer flush
      this.fragLoadIdx += 2 * this.config.fragLoadingLoopThreshold;
      // flush everything
      this.flushMainBuffer(0, Number.POSITIVE_INFINITY);
    }

    /*
       on immediate level switch end, after new fragment has been buffered :
        - nudge video decoder by slightly adjusting video currentTime (if currentTime buffered)
        - resume the playback if needed
    */

  }, {
    key: 'immediateLevelSwitchEnd',
    value: function immediateLevelSwitchEnd() {
      var media = this.media;
      if (media && media.buffered.length) {
        this.immediateSwitch = false;
        if (_bufferHelper2.default.isBuffered(media, media.currentTime)) {
          // only nudge if currentTime is buffered
          media.currentTime -= 0.0001;
        }
        if (!this.previouslyPaused) {
          media.play();
        }
      }
    }
  }, {
    key: 'nextLevelSwitch',
    value: function nextLevelSwitch() {
      /* try to switch ASAP without breaking video playback :
         in order to ensure smooth but quick level switching,
        we need to find the next flushable buffer range
        we should take into account new segment fetch time
      */
      var media = this.media;
      // ensure that media is defined and that metadata are available (to retrieve currentTime)
      if (media && media.readyState) {
        var fetchdelay = void 0,
            fragPlayingCurrent = void 0,
            nextBufferedFrag = void 0;
        // increase fragment load Index to avoid frag loop loading error after buffer flush
        this.fragLoadIdx += 2 * this.config.fragLoadingLoopThreshold;
        fragPlayingCurrent = this.getBufferedFrag(media.currentTime);
        if (fragPlayingCurrent && fragPlayingCurrent.startPTS > 1) {
          // flush buffer preceding current fragment (flush until current fragment start offset)
          // minus 1s to avoid video freezing, that could happen if we flush keyframe of current video ...
          this.flushMainBuffer(0, fragPlayingCurrent.startPTS - 1);
        }
        if (!media.paused) {
          // add a safety delay of 1s
          var nextLevelId = this.hls.nextLoadLevel,
              nextLevel = this.levels[nextLevelId],
              fragLastKbps = this.fragLastKbps;
          if (fragLastKbps && this.fragCurrent) {
            fetchdelay = this.fragCurrent.duration * nextLevel.bitrate / (1000 * fragLastKbps) + 1;
          } else {
            fetchdelay = 0;
          }
        } else {
          fetchdelay = 0;
        }
        //logger.log('fetchdelay:'+fetchdelay);
        // find buffer range that will be reached once new fragment will be fetched
        nextBufferedFrag = this.getBufferedFrag(media.currentTime + fetchdelay);
        if (nextBufferedFrag) {
          // we can flush buffer range following this one without stalling playback
          nextBufferedFrag = this.followingBufferedFrag(nextBufferedFrag);
          if (nextBufferedFrag) {
            // if we are here, we can also cancel any loading/demuxing in progress, as they are useless
            var fragCurrent = this.fragCurrent;
            if (fragCurrent && fragCurrent.loader) {
              fragCurrent.loader.abort();
            }
            this.fragCurrent = null;
            // flush position is the start position of this new buffer
            this.flushMainBuffer(nextBufferedFrag.startPTS, Number.POSITIVE_INFINITY);
          }
        }
      }
    }
  }, {
    key: 'flushMainBuffer',
    value: function flushMainBuffer(startOffset, endOffset) {
      this.state = State.BUFFER_FLUSHING;
      var flushScope = { startOffset: startOffset, endOffset: endOffset };
      // if alternate audio tracks are used, only flush video, otherwise flush everything
      if (this.altAudio) {
        flushScope.type = 'video';
      }
      this.hls.trigger(_events2.default.BUFFER_FLUSHING, flushScope);
    }
  }, {
    key: 'onMediaAttached',
    value: function onMediaAttached(data) {
      var media = this.media = this.mediaBuffer = data.media;
      this.onvseeking = this.onMediaSeeking.bind(this);
      this.onvseeked = this.onMediaSeeked.bind(this);
      this.onvended = this.onMediaEnded.bind(this);
      media.addEventListener('seeking', this.onvseeking);
      media.addEventListener('seeked', this.onvseeked);
      media.addEventListener('ended', this.onvended);
      var config = this.config;
      if (this.levels && config.autoStartLoad) {
        this.hls.startLoad(config.startPosition);
      }
    }
  }, {
    key: 'onMediaDetaching',
    value: function onMediaDetaching() {
      var media = this.media;
      if (media && media.ended) {
        _logger.logger.log('MSE detaching and video ended, reset startPosition');
        this.startPosition = this.lastCurrentTime = 0;
      }

      // reset fragment loading counter on MSE detaching to avoid reporting FRAG_LOOP_LOADING_ERROR after error recovery
      var levels = this.levels;
      if (levels) {
        // reset fragment load counter
        levels.forEach(function (level) {
          if (level.details) {
            level.details.fragments.forEach(function (fragment) {
              fragment.loadCounter = undefined;
              fragment.backtracked = undefined;
            });
          }
        });
      }
      // remove video listeners
      if (media) {
        media.removeEventListener('seeking', this.onvseeking);
        media.removeEventListener('seeked', this.onvseeked);
        media.removeEventListener('ended', this.onvended);
        this.onvseeking = this.onvseeked = this.onvended = null;
      }
      this.media = this.mediaBuffer = null;
      this.loadedmetadata = false;
      this.stopLoad();
    }
  }, {
    key: 'onMediaSeeking',
    value: function onMediaSeeking() {
      var media = this.media,
          currentTime = media ? media.currentTime : undefined,
          config = this.config;
      _logger.logger.log('media seeking to ' + currentTime.toFixed(3));
      if (this.state === State.FRAG_LOADING) {
        var mediaBuffer = this.mediaBuffer ? this.mediaBuffer : media;
        var bufferInfo = _bufferHelper2.default.bufferInfo(mediaBuffer, currentTime, this.config.maxBufferHole),
            fragCurrent = this.fragCurrent;
        // check if we are seeking to a unbuffered area AND if frag loading is in progress
        if (bufferInfo.len === 0 && fragCurrent) {
          var tolerance = config.maxFragLookUpTolerance,
              fragStartOffset = fragCurrent.start - tolerance,
              fragEndOffset = fragCurrent.start + fragCurrent.duration + tolerance;
          // check if we seek position will be out of currently loaded frag range : if out cancel frag load, if in, don't do anything
          if (currentTime < fragStartOffset || currentTime > fragEndOffset) {
            if (fragCurrent.loader) {
              _logger.logger.log('seeking outside of buffer while fragment load in progress, cancel fragment load');
              fragCurrent.loader.abort();
            }
            this.fragCurrent = null;
            this.fragPrevious = null;
            // switch to IDLE state to load new fragment
            this.state = State.IDLE;
          } else {
            _logger.logger.log('seeking outside of buffer but within currently loaded fragment range');
          }
        }
      } else if (this.state === State.ENDED) {
        // switch to IDLE state to check for potential new fragment
        this.state = State.IDLE;
      }
      if (media) {
        this.lastCurrentTime = currentTime;
      }
      // avoid reporting fragment loop loading error in case user is seeking several times on same position
      if (this.state !== State.FRAG_LOADING && this.fragLoadIdx !== undefined) {
        this.fragLoadIdx += 2 * config.fragLoadingLoopThreshold;
      }
      // in case seeking occurs although no media buffered, adjust startPosition and nextLoadPosition to seek target
      if (!this.loadedmetadata) {
        this.nextLoadPosition = this.startPosition = currentTime;
      }
      // tick to speed up processing
      this.tick();
    }
  }, {
    key: 'onMediaSeeked',
    value: function onMediaSeeked() {
      _logger.logger.log('media seeked to ' + this.media.currentTime.toFixed(3));
      // tick to speed up FRAGMENT_PLAYING triggering
      this.tick();
    }
  }, {
    key: 'onMediaEnded',
    value: function onMediaEnded() {
      _logger.logger.log('media ended');
      // reset startPosition and lastCurrentTime to restart playback @ stream beginning
      this.startPosition = this.lastCurrentTime = 0;
    }
  }, {
    key: 'onManifestLoading',
    value: function onManifestLoading() {
      // reset buffer on manifest loading
      _logger.logger.log('trigger BUFFER_RESET');
      this.hls.trigger(_events2.default.BUFFER_RESET);
      this._bufferedFrags = [];
      this.stalled = false;
      this.startPosition = this.lastCurrentTime = 0;
    }
  }, {
    key: 'onManifestParsed',
    value: function onManifestParsed(data) {
      var aac = false,
          heaac = false,
          codec;
      data.levels.forEach(function (level) {
        // detect if we have different kind of audio codecs used amongst playlists
        codec = level.audioCodec;
        if (codec) {
          if (codec.indexOf('mp4a.40.2') !== -1) {
            aac = true;
          }
          if (codec.indexOf('mp4a.40.5') !== -1) {
            heaac = true;
          }
        }
      });
      this.audioCodecSwitch = aac && heaac;
      if (this.audioCodecSwitch) {
        _logger.logger.log('both AAC/HE-AAC audio found in levels; declaring level codec as HE-AAC');
      }
      this.levels = data.levels;
      this.startLevelLoaded = false;
      this.startFragRequested = false;
      var config = this.config;
      if (config.autoStartLoad) {
        this.hls.startLoad(config.startPosition);
      }
    }
  }, {
    key: 'onLevelLoaded',
    value: function onLevelLoaded(data) {
      var newDetails = data.details,
          newLevelId = data.level,
          curLevel = this.levels[newLevelId],
          duration = newDetails.totalduration,
          sliding = 0;

      _logger.logger.log('level ' + newLevelId + ' loaded [' + newDetails.startSN + ',' + newDetails.endSN + '],duration:' + duration);
      this.levelLastLoaded = newLevelId;

      if (newDetails.live) {
        var curDetails = curLevel.details;
        if (curDetails && newDetails.fragments.length > 0) {
          // we already have details for that level, merge them
          _levelHelper2.default.mergeDetails(curDetails, newDetails);
          sliding = newDetails.fragments[0].start;
          this.liveSyncPosition = this.computeLivePosition(sliding, curDetails);
          if (newDetails.PTSKnown) {
            _logger.logger.log('live playlist sliding:' + sliding.toFixed(3));
          } else {
            _logger.logger.log('live playlist - outdated PTS, unknown sliding');
          }
        } else {
          newDetails.PTSKnown = false;
          _logger.logger.log('live playlist - first load, unknown sliding');
        }
      } else {
        newDetails.PTSKnown = false;
      }
      // override level info
      curLevel.details = newDetails;
      this.hls.trigger(_events2.default.LEVEL_UPDATED, { details: newDetails, level: newLevelId });

      if (this.startFragRequested === false) {
        // compute start position if set to -1. use it straight away if value is defined
        if (this.startPosition === -1 || this.lastCurrentTime === -1) {
          // first, check if start time offset has been set in playlist, if yes, use this value
          var startTimeOffset = newDetails.startTimeOffset;
          if (!isNaN(startTimeOffset)) {
            if (startTimeOffset < 0) {
              _logger.logger.log('negative start time offset ' + startTimeOffset + ', count from end of last fragment');
              startTimeOffset = sliding + duration + startTimeOffset;
            }
            _logger.logger.log('start time offset found in playlist, adjust startPosition to ' + startTimeOffset);
            this.startPosition = startTimeOffset;
          } else {
            // if live playlist, set start position to be fragment N-this.config.liveSyncDurationCount (usually 3)
            if (newDetails.live) {
              this.startPosition = this.computeLivePosition(sliding, newDetails);
              _logger.logger.log('configure startPosition to ' + this.startPosition);
            } else {
              this.startPosition = 0;
            }
          }
          this.lastCurrentTime = this.startPosition;
        }
        this.nextLoadPosition = this.startPosition;
      }
      // only switch batck to IDLE state if we were waiting for level to start downloading a new fragment
      if (this.state === State.WAITING_LEVEL) {
        this.state = State.IDLE;
      }
      //trigger handler right now
      this.tick();
    }
  }, {
    key: 'onKeyLoaded',
    value: function onKeyLoaded() {
      if (this.state === State.KEY_LOADING) {
        this.state = State.IDLE;
        this.tick();
      }
    }
  }, {
    key: 'onFragLoaded',
    value: function onFragLoaded(data) {
      var fragCurrent = this.fragCurrent,
          fragLoaded = data.frag;
      if (this.state === State.FRAG_LOADING && fragCurrent && fragLoaded.type === 'main' && fragLoaded.level === fragCurrent.level && fragLoaded.sn === fragCurrent.sn) {
        var stats = data.stats,
            currentLevel = this.levels[fragCurrent.level],
            details = currentLevel.details;
        _logger.logger.log('Loaded  ' + fragCurrent.sn + ' of [' + details.startSN + ' ,' + details.endSN + '],level ' + fragCurrent.level);
        // reset frag bitrate test in any case after frag loaded event
        this.bitrateTest = false;
        this.stats = stats;
        // if this frag was loaded to perform a bitrate test AND if hls.nextLoadLevel is greater than 0
        // then this means that we should be able to load a fragment at a higher quality level
        if (fragLoaded.bitrateTest === true && this.hls.nextLoadLevel) {
          // switch back to IDLE state ... we just loaded a fragment to determine adequate start bitrate and initialize autoswitch algo
          this.state = State.IDLE;
          this.startFragRequested = false;
          stats.tparsed = stats.tbuffered = performance.now();
          this.hls.trigger(_events2.default.FRAG_BUFFERED, { stats: stats, frag: fragCurrent, id: 'main' });
          this.tick();
        } else if (fragLoaded.sn === 'initSegment') {
          this.state = State.IDLE;
          stats.tparsed = stats.tbuffered = performance.now();
          details.initSegment.data = data.payload;
          this.hls.trigger(_events2.default.FRAG_BUFFERED, { stats: stats, frag: fragCurrent, id: 'main' });
          this.tick();
        } else {
          this.state = State.PARSING;
          // transmux the MPEG-TS data to ISO-BMFF segments
          var duration = details.totalduration,
              level = fragCurrent.level,
              sn = fragCurrent.sn,
              audioCodec = this.config.defaultAudioCodec || currentLevel.audioCodec;
          if (this.audioCodecSwap) {
            _logger.logger.log('swapping playlist audio codec');
            if (audioCodec === undefined) {
              audioCodec = this.lastAudioCodec;
            }
            if (audioCodec) {
              if (audioCodec.indexOf('mp4a.40.5') !== -1) {
                audioCodec = 'mp4a.40.2';
              } else {
                audioCodec = 'mp4a.40.5';
              }
            }
          }
          this.pendingBuffering = true;
          this.appended = false;
          _logger.logger.log('Parsing ' + sn + ' of [' + details.startSN + ' ,' + details.endSN + '],level ' + level + ', cc ' + fragCurrent.cc);
          var demuxer = this.demuxer;
          if (!demuxer) {
            demuxer = this.demuxer = new _demuxer2.default(this.hls, 'main');
          }
          // time Offset is accurate if level PTS is known, or if playlist is not sliding (not live) and if media is not seeking (this is to overcome potential timestamp drifts between playlists and fragments)
          var media = this.media;
          var mediaSeeking = media && media.seeking;
          var accurateTimeOffset = !mediaSeeking && (details.PTSKnown || !details.live);
          var initSegmentData = details.initSegment ? details.initSegment.data : [];
          demuxer.push(data.payload, initSegmentData, audioCodec, currentLevel.videoCodec, fragCurrent, duration, accurateTimeOffset, undefined);
        }
      }
      this.fragLoadError = 0;
    }
  }, {
    key: 'onFragParsingInitSegment',
    value: function onFragParsingInitSegment(data) {
      var fragCurrent = this.fragCurrent;
      var fragNew = data.frag;
      if (fragCurrent && data.id === 'main' && fragNew.sn === fragCurrent.sn && fragNew.level === fragCurrent.level && this.state === State.PARSING) {
        var tracks = data.tracks,
            trackName,
            track;

        // if audio track is expected to come from audio stream controller, discard any coming from main
        if (tracks.audio && this.altAudio) {
          delete tracks.audio;
        }
        // include levelCodec in audio and video tracks
        track = tracks.audio;
        if (track) {
          var audioCodec = this.levels[this.level].audioCodec,
              ua = navigator.userAgent.toLowerCase();
          if (audioCodec && this.audioCodecSwap) {
            _logger.logger.log('swapping playlist audio codec');
            if (audioCodec.indexOf('mp4a.40.5') !== -1) {
              audioCodec = 'mp4a.40.2';
            } else {
              audioCodec = 'mp4a.40.5';
            }
          }
          // in case AAC and HE-AAC audio codecs are signalled in manifest
          // force HE-AAC , as it seems that most browsers prefers that way,
          // except for mono streams OR on FF
          // these conditions might need to be reviewed ...
          if (this.audioCodecSwitch) {
            // don't force HE-AAC if mono stream
            if (track.metadata.channelCount !== 1 &&
            // don't force HE-AAC if firefox
            ua.indexOf('firefox') === -1) {
              audioCodec = 'mp4a.40.5';
            }
          }
          // HE-AAC is broken on Android, always signal audio codec as AAC even if variant manifest states otherwise
          if (ua.indexOf('android') !== -1 && track.container !== 'audio/mpeg') {
            // Exclude mpeg audio
            audioCodec = 'mp4a.40.2';
            _logger.logger.log('Android: force audio codec to ' + audioCodec);
          }
          track.levelCodec = audioCodec;
          track.id = data.id;
        }
        track = tracks.video;
        if (track) {
          track.levelCodec = this.levels[this.level].videoCodec;
          track.id = data.id;
        }
        this.hls.trigger(_events2.default.BUFFER_CODECS, tracks);
        // loop through tracks that are going to be provided to bufferController
        for (trackName in tracks) {
          track = tracks[trackName];
          _logger.logger.log('main track:' + trackName + ',container:' + track.container + ',codecs[level/parsed]=[' + track.levelCodec + '/' + track.codec + ']');
          var initSegment = track.initSegment;
          if (initSegment) {
            this.appended = true;
            // arm pending Buffering flag before appending a segment
            this.pendingBuffering = true;
            this.hls.trigger(_events2.default.BUFFER_APPENDING, { type: trackName, data: initSegment, parent: 'main', content: 'initSegment' });
          }
        }
        //trigger handler right now
        this.tick();
      }
    }
  }, {
    key: 'onFragParsingData',
    value: function onFragParsingData(data) {
      var _this2 = this;

      var fragCurrent = this.fragCurrent;
      var fragNew = data.frag;
      if (fragCurrent && data.id === 'main' && fragNew.sn === fragCurrent.sn && fragNew.level === fragCurrent.level && !(data.type === 'audio' && this.altAudio) && // filter out main audio if audio track is loaded through audio stream controller
      this.state === State.PARSING) {
        var level = this.levels[this.level],
            frag = fragCurrent;
        if (isNaN(data.endPTS)) {
          data.endPTS = data.startPTS + fragCurrent.duration;
          data.endDTS = data.startDTS + fragCurrent.duration;
        }

        _logger.logger.log('Parsed ' + data.type + ',PTS:[' + data.startPTS.toFixed(3) + ',' + data.endPTS.toFixed(3) + '],DTS:[' + data.startDTS.toFixed(3) + '/' + data.endDTS.toFixed(3) + '],nb:' + data.nb + ',dropped:' + (data.dropped || 0));

        // Detect gaps in a fragment  and try to fix it by finding a keyframe in the previous fragment (see _findFragments)
        if (data.type === 'video') {
          frag.dropped = data.dropped;
          if (frag.dropped) {
            if (!frag.backtracked) {
              // Return back to the IDLE state without appending to buffer
              // Causes findFragments to backtrack a segment and find the keyframe
              // Audio fragments arriving before video sets the nextLoadPosition, causing _findFragments to skip the backtracked fragment
              frag.backtracked = true;
              this.nextLoadPosition = data.startPTS;
              this.state = State.IDLE;
              this.tick();
              return;
            } else {
              _logger.logger.warn('Already backtracked on this fragment, appending with the gap');
            }
          } else {
            // Only reset the backtracked flag if we've loaded the frag without any dropped frames
            frag.backtracked = false;
          }
        }

        var drift = _levelHelper2.default.updateFragPTSDTS(level.details, frag.sn, data.startPTS, data.endPTS, data.startDTS, data.endDTS),
            hls = this.hls;
        hls.trigger(_events2.default.LEVEL_PTS_UPDATED, { details: level.details, level: this.level, drift: drift, type: data.type, start: data.startPTS, end: data.endPTS });

        // has remuxer dropped video frames located before first keyframe ?
        [data.data1, data.data2].forEach(function (buffer) {
          // only append in PARSING state (rationale is that an appending error could happen synchronously on first segment appending)
          // in that case it is useless to append following segments
          if (buffer && buffer.length && _this2.state === State.PARSING) {
            _this2.appended = true;
            // arm pending Buffering flag before appending a segment
            _this2.pendingBuffering = true;
            hls.trigger(_events2.default.BUFFER_APPENDING, { type: data.type, data: buffer, parent: 'main', content: 'data' });
          }
        });
        //trigger handler right now
        this.tick();
      }
    }
  }, {
    key: 'onFragParsed',
    value: function onFragParsed(data) {
      var fragCurrent = this.fragCurrent;
      var fragNew = data.frag;
      if (fragCurrent && data.id === 'main' && fragNew.sn === fragCurrent.sn && fragNew.level === fragCurrent.level && this.state === State.PARSING) {
        this.stats.tparsed = performance.now();
        this.state = State.PARSED;
        this._checkAppendedParsed();
      }
    }
  }, {
    key: 'onAudioTrackSwitching',
    value: function onAudioTrackSwitching(data) {
      // if any URL found on new audio track, it is an alternate audio track
      var altAudio = !!data.url,
          trackId = data.id;
      // if we switch on main audio, ensure that main fragment scheduling is synced with media.buffered
      // don't do anything if we switch to alt audio: audio stream controller is handling it.
      // we will just have to change buffer scheduling on audioTrackSwitched
      if (!altAudio) {
        if (this.mediaBuffer !== this.media) {
          _logger.logger.log('switching on main audio, use media.buffered to schedule main fragment loading');
          this.mediaBuffer = this.media;
          var fragCurrent = this.fragCurrent;
          // we need to refill audio buffer from main: cancel any frag loading to speed up audio switch
          if (fragCurrent.loader) {
            _logger.logger.log('switching to main audio track, cancel main fragment load');
            fragCurrent.loader.abort();
          }
          this.fragCurrent = null;
          this.fragPrevious = null;
          // destroy demuxer to force init segment generation (following audio switch)
          if (this.demuxer) {
            this.demuxer.destroy();
            this.demuxer = null;
          }
          // switch to IDLE state to load new fragment
          this.state = State.IDLE;
        }
        var hls = this.hls;
        // switching to main audio, flush all audio and trigger track switched
        hls.trigger(_events2.default.BUFFER_FLUSHING, { startOffset: 0, endOffset: Number.POSITIVE_INFINITY, type: 'audio' });
        hls.trigger(_events2.default.AUDIO_TRACK_SWITCHED, { id: trackId });
        this.altAudio = false;
      }
    }
  }, {
    key: 'onAudioTrackSwitched',
    value: function onAudioTrackSwitched(data) {
      var trackId = data.id,
          altAudio = !!this.hls.audioTracks[trackId].url;
      if (altAudio) {
        var videoBuffer = this.videoBuffer;
        // if we switched on alternate audio, ensure that main fragment scheduling is synced with video sourcebuffer buffered
        if (videoBuffer && this.mediaBuffer !== videoBuffer) {
          _logger.logger.log('switching on alternate audio, use video.buffered to schedule main fragment loading');
          this.mediaBuffer = videoBuffer;
        }
      }
      this.altAudio = altAudio;
      this.tick();
    }
  }, {
    key: 'onBufferCreated',
    value: function onBufferCreated(data) {
      var tracks = data.tracks,
          mediaTrack = void 0,
          name = void 0,
          alternate = false;
      for (var type in tracks) {
        var track = tracks[type];
        if (track.id === 'main') {
          name = type;
          mediaTrack = track;
          // keep video source buffer reference
          if (type === 'video') {
            this.videoBuffer = tracks[type].buffer;
          }
        } else {
          alternate = true;
        }
      }
      if (alternate && mediaTrack) {
        _logger.logger.log('alternate track found, use ' + name + '.buffered to schedule main fragment loading');
        this.mediaBuffer = mediaTrack.buffer;
      } else {
        this.mediaBuffer = this.media;
      }
    }
  }, {
    key: 'onBufferAppended',
    value: function onBufferAppended(data) {
      if (data.parent === 'main') {
        var state = this.state;
        if (state === State.PARSING || state === State.PARSED) {
          // check if all buffers have been appended
          this.pendingBuffering = data.pending > 0;
          this._checkAppendedParsed();
        }
      }
    }
  }, {
    key: '_checkAppendedParsed',
    value: function _checkAppendedParsed() {
      //trigger handler right now
      if (this.state === State.PARSED && (!this.appended || !this.pendingBuffering)) {
        var frag = this.fragCurrent;
        if (frag) {
          var media = this.mediaBuffer ? this.mediaBuffer : this.media;
          _logger.logger.log('main buffered : ' + _timeRanges2.default.toString(media.buffered));
          // filter fragments potentially evicted from buffer. this is to avoid memleak on live streams
          var bufferedFrags = this._bufferedFrags.filter(function (frag) {
            return _bufferHelper2.default.isBuffered(media, (frag.startPTS + frag.endPTS) / 2);
          });
          // push new range
          bufferedFrags.push(frag);
          // sort frags, as we use BinarySearch for lookup in getBufferedFrag ...
          this._bufferedFrags = bufferedFrags.sort(function (a, b) {
            return a.startPTS - b.startPTS;
          });
          this.fragPrevious = frag;
          var stats = this.stats;
          stats.tbuffered = performance.now();
          // we should get rid of this.fragLastKbps
          this.fragLastKbps = Math.round(8 * stats.total / (stats.tbuffered - stats.tfirst));
          this.hls.trigger(_events2.default.FRAG_BUFFERED, { stats: stats, frag: frag, id: 'main' });
          this.state = State.IDLE;
        }
        this.tick();
      }
    }
  }, {
    key: 'onError',
    value: function onError(data) {
      var frag = data.frag || this.fragCurrent;
      // don't handle frag error not related to main fragment
      if (frag && frag.type !== 'main') {
        return;
      }
      var media = this.media,

      // 0.5 : tolerance needed as some browsers stalls playback before reaching buffered end
      mediaBuffered = media && _bufferHelper2.default.isBuffered(media, media.currentTime) && _bufferHelper2.default.isBuffered(media, media.currentTime + 0.5);
      switch (data.details) {
        case _errors.ErrorDetails.FRAG_LOAD_ERROR:
        case _errors.ErrorDetails.FRAG_LOAD_TIMEOUT:
        case _errors.ErrorDetails.KEY_LOAD_ERROR:
        case _errors.ErrorDetails.KEY_LOAD_TIMEOUT:
          if (!data.fatal) {
            var loadError = this.fragLoadError;
            if (loadError) {
              loadError++;
            } else {
              loadError = 1;
            }
            var config = this.config;
            // keep retrying / don't raise fatal network error if current position is buffered or if in automode with current level not 0
            if (loadError <= config.fragLoadingMaxRetry || mediaBuffered || frag.autoLevel && frag.level) {
              this.fragLoadError = loadError;
              // reset load counter to avoid frag loop loading error
              frag.loadCounter = 0;
              // exponential backoff capped to config.fragLoadingMaxRetryTimeout
              var delay = Math.min(Math.pow(2, loadError - 1) * config.fragLoadingRetryDelay, config.fragLoadingMaxRetryTimeout);
              _logger.logger.warn('mediaController: frag loading failed, retry in ' + delay + ' ms');
              this.retryDate = performance.now() + delay;
              // retry loading state
              // if loadedmetadata is not set, it means that we are emergency switch down on first frag
              // in that case, reset startFragRequested flag
              if (!this.loadedmetadata) {
                this.startFragRequested = false;
                this.nextLoadPosition = this.startPosition;
              }
              this.state = State.FRAG_LOADING_WAITING_RETRY;
            } else {
              _logger.logger.error('mediaController: ' + data.details + ' reaches max retry, redispatch as fatal ...');
              // switch error to fatal
              data.fatal = true;
              this.state = State.ERROR;
            }
          }
          break;
        case _errors.ErrorDetails.FRAG_LOOP_LOADING_ERROR:
          if (!data.fatal) {
            // if buffer is not empty
            if (mediaBuffered) {
              // try to reduce max buffer length : rationale is that we could get
              // frag loop loading error because of buffer eviction
              this._reduceMaxBufferLength(frag.duration);
              this.state = State.IDLE;
            } else {
              // buffer empty. report as fatal if in manual mode or if lowest level.
              // level controller takes care of emergency switch down logic
              if (!frag.autoLevel || frag.level === 0) {
                // switch error to fatal
                data.fatal = true;
                this.state = State.ERROR;
              }
            }
          }
          break;
        case _errors.ErrorDetails.LEVEL_LOAD_ERROR:
        case _errors.ErrorDetails.LEVEL_LOAD_TIMEOUT:
          if (this.state !== State.ERROR) {
            if (data.fatal) {
              // if fatal error, stop processing
              this.state = State.ERROR;
              _logger.logger.warn('streamController: ' + data.details + ',switch to ' + this.state + ' state ...');
            } else {
              // in cas of non fatal error while waiting level load to be completed, switch back to IDLE
              if (this.state === State.WAITING_LEVEL) {
                this.state = State.IDLE;
              }
            }
          }
          break;
        case _errors.ErrorDetails.BUFFER_FULL_ERROR:
          // if in appending state
          if (data.parent === 'main' && (this.state === State.PARSING || this.state === State.PARSED)) {
            // reduce max buf len if current position is buffered
            if (mediaBuffered) {
              this._reduceMaxBufferLength(this.config.maxBufferLength);
              this.state = State.IDLE;
            } else {
              // current position is not buffered, but browser is still complaining about buffer full error
              // this happens on IE/Edge, refer to https://github.com/video-dev/hls.js/pull/708
              // in that case flush the whole buffer to recover
              _logger.logger.warn('buffer full error also media.currentTime is not buffered, flush everything');
              this.fragCurrent = null;
              // flush everything
              this.flushMainBuffer(0, Number.POSITIVE_INFINITY);
            }
          }
          break;
        default:
          break;
      }
    }
  }, {
    key: '_reduceMaxBufferLength',
    value: function _reduceMaxBufferLength(minLength) {
      var config = this.config;
      if (config.maxMaxBufferLength >= minLength) {
        // reduce max buffer length as it might be too high. we do this to avoid loop flushing ...
        config.maxMaxBufferLength /= 2;
        _logger.logger.warn('main:reduce max buffer length to ' + config.maxMaxBufferLength + 's');
        // increase fragment load Index to avoid frag loop loading error after buffer flush
        this.fragLoadIdx += 2 * config.fragLoadingLoopThreshold;
      }
    }
  }, {
    key: '_checkBuffer',
    value: function _checkBuffer() {
      var media = this.media;
      // if ready state different from HAVE_NOTHING (numeric value 0), we are allowed to seek
      if (media && media.readyState) {
        var currentTime = media.currentTime,
            mediaBuffer = this.mediaBuffer ? this.mediaBuffer : media,
            buffered = mediaBuffer.buffered;
        // adjust currentTime to start position on loaded metadata
        if (!this.loadedmetadata && buffered.length) {
          this.loadedmetadata = true;
          // only adjust currentTime if different from startPosition or if startPosition not buffered
          // at that stage, there should be only one buffered range, as we reach that code after first fragment has been buffered
          var startPosition = media.seeking ? currentTime : this.startPosition,
              startPositionBuffered = _bufferHelper2.default.isBuffered(mediaBuffer, startPosition);
          // if currentTime not matching with expected startPosition or startPosition not buffered
          if (currentTime !== startPosition || !startPositionBuffered) {
            _logger.logger.log('target start position:' + startPosition);
            // if startPosition not buffered, let's seek to buffered.start(0)
            if (!startPositionBuffered) {
              startPosition = buffered.start(0);
              _logger.logger.log('target start position not buffered, seek to buffered.start(0) ' + startPosition);
            }
            _logger.logger.log('adjust currentTime from ' + currentTime + ' to ' + startPosition);
            media.currentTime = startPosition;
          }
        } else if (this.immediateSwitch) {
          this.immediateLevelSwitchEnd();
        } else {
          var bufferInfo = _bufferHelper2.default.bufferInfo(media, currentTime, 0),
              expectedPlaying = !(media.paused || // not playing when media is paused
          media.ended || // not playing when media is ended
          media.buffered.length === 0),
              // not playing if nothing buffered
          jumpThreshold = 0.5,
              // tolerance needed as some browsers stalls playback before reaching buffered range end
          playheadMoving = currentTime !== this.lastCurrentTime,
              config = this.config;

          if (playheadMoving) {
            // played moving, but was previously stalled => now not stuck anymore
            if (this.stallReported) {
              _logger.logger.warn('playback not stuck anymore @' + currentTime + ', after ' + Math.round(performance.now() - this.stalled) + 'ms');
              this.stallReported = false;
            }
            this.stalled = undefined;
            this.nudgeRetry = 0;
          } else {
            // playhead not moving
            if (expectedPlaying) {
              // playhead not moving BUT media expected to play
              var tnow = performance.now();
              var hls = this.hls;
              if (!this.stalled) {
                // stall just detected, store current time
                this.stalled = tnow;
                this.stallReported = false;
              } else {
                // playback already stalled, check stalling duration
                // if stalling for more than a given threshold, let's try to recover
                var stalledDuration = tnow - this.stalled;
                var bufferLen = bufferInfo.len;
                var nudgeRetry = this.nudgeRetry || 0;
                // have we reached stall deadline ?
                if (bufferLen <= jumpThreshold && stalledDuration > config.lowBufferWatchdogPeriod * 1000) {
                  // report stalled error once
                  if (!this.stallReported) {
                    this.stallReported = true;
                    _logger.logger.warn('playback stalling in low buffer @' + currentTime);
                    hls.trigger(_events2.default.ERROR, { type: _errors.ErrorTypes.MEDIA_ERROR, details: _errors.ErrorDetails.BUFFER_STALLED_ERROR, fatal: false, buffer: bufferLen });
                  }
                  // if buffer len is below threshold, try to jump to start of next buffer range if close
                  // no buffer available @ currentTime, check if next buffer is close (within a config.maxSeekHole second range)
                  var nextBufferStart = bufferInfo.nextStart,
                      delta = nextBufferStart - currentTime;
                  if (nextBufferStart && delta < config.maxSeekHole && delta > 0) {
                    this.nudgeRetry = ++nudgeRetry;
                    var nudgeOffset = nudgeRetry * config.nudgeOffset;
                    // next buffer is close ! adjust currentTime to nextBufferStart
                    // this will ensure effective video decoding
                    _logger.logger.log('adjust currentTime from ' + media.currentTime + ' to next buffered @ ' + nextBufferStart + ' + nudge ' + nudgeOffset);
                    media.currentTime = nextBufferStart + nudgeOffset;
                    // reset stalled so to rearm watchdog timer
                    this.stalled = undefined;
                    hls.trigger(_events2.default.ERROR, { type: _errors.ErrorTypes.MEDIA_ERROR, details: _errors.ErrorDetails.BUFFER_SEEK_OVER_HOLE, fatal: false, hole: nextBufferStart + nudgeOffset - currentTime });
                  }
                } else if (bufferLen > jumpThreshold && stalledDuration > config.highBufferWatchdogPeriod * 1000) {
                  // report stalled error once
                  if (!this.stallReported) {
                    this.stallReported = true;
                    _logger.logger.warn('playback stalling in high buffer @' + currentTime);
                    hls.trigger(_events2.default.ERROR, { type: _errors.ErrorTypes.MEDIA_ERROR, details: _errors.ErrorDetails.BUFFER_STALLED_ERROR, fatal: false, buffer: bufferLen });
                  }
                  // reset stalled so to rearm watchdog timer
                  this.stalled = undefined;
                  this.nudgeRetry = ++nudgeRetry;
                  if (nudgeRetry < config.nudgeMaxRetry) {
                    var _currentTime = media.currentTime;
                    var targetTime = _currentTime + nudgeRetry * config.nudgeOffset;
                    _logger.logger.log('adjust currentTime from ' + _currentTime + ' to ' + targetTime);
                    // playback stalled in buffered area ... let's nudge currentTime to try to overcome this
                    media.currentTime = targetTime;
                    hls.trigger(_events2.default.ERROR, { type: _errors.ErrorTypes.MEDIA_ERROR, details: _errors.ErrorDetails.BUFFER_NUDGE_ON_STALL, fatal: false });
                  } else {
                    _logger.logger.error('still stuck in high buffer @' + currentTime + ' after ' + config.nudgeMaxRetry + ', raise fatal error');
                    hls.trigger(_events2.default.ERROR, { type: _errors.ErrorTypes.MEDIA_ERROR, details: _errors.ErrorDetails.BUFFER_STALLED_ERROR, fatal: true });
                  }
                }
              }
            }
          }
        }
      }
    }
  }, {
    key: 'onFragLoadEmergencyAborted',
    value: function onFragLoadEmergencyAborted() {
      this.state = State.IDLE;
      // if loadedmetadata is not set, it means that we are emergency switch down on first frag
      // in that case, reset startFragRequested flag
      if (!this.loadedmetadata) {
        this.startFragRequested = false;
        this.nextLoadPosition = this.startPosition;
      }
      this.tick();
    }
  }, {
    key: 'onBufferFlushed',
    value: function onBufferFlushed() {
      /* after successful buffer flushing, filter flushed fragments from bufferedFrags
        use mediaBuffered instead of media (so that we will check against video.buffered ranges in case of alt audio track)
      */
      var media = this.mediaBuffer ? this.mediaBuffer : this.media;
      this._bufferedFrags = this._bufferedFrags.filter(function (frag) {
        return _bufferHelper2.default.isBuffered(media, (frag.startPTS + frag.endPTS) / 2);
      });

      // increase fragment load Index to avoid frag loop loading error after buffer flush
      this.fragLoadIdx += 2 * this.config.fragLoadingLoopThreshold;
      // move to IDLE once flush complete. this should trigger new fragment loading
      this.state = State.IDLE;
      // reset reference to frag
      this.fragPrevious = null;
    }
  }, {
    key: 'swapAudioCodec',
    value: function swapAudioCodec() {
      this.audioCodecSwap = !this.audioCodecSwap;
    }
  }, {
    key: 'computeLivePosition',
    value: function computeLivePosition(sliding, levelDetails) {
      var targetLatency = this.config.liveSyncDuration !== undefined ? this.config.liveSyncDuration : this.config.liveSyncDurationCount * levelDetails.targetduration;
      return sliding + Math.max(0, levelDetails.totalduration - targetLatency);
    }
  }, {
    key: 'state',
    set: function set(nextState) {
      if (this.state !== nextState) {
        var previousState = this.state;
        this._state = nextState;
        _logger.logger.log('main stream:' + previousState + '->' + nextState);
        this.hls.trigger(_events2.default.STREAM_STATE_TRANSITION, { previousState: previousState, nextState: nextState });
      }
    },
    get: function get() {
      return this._state;
    }
  }, {
    key: 'currentLevel',
    get: function get() {
      var media = this.media;
      if (media) {
        var frag = this.getBufferedFrag(media.currentTime);
        if (frag) {
          return frag.level;
        }
      }
      return -1;
    }
  }, {
    key: 'nextBufferedFrag',
    get: function get() {
      var media = this.media;
      if (media) {
        // first get end range of current fragment
        return this.followingBufferedFrag(this.getBufferedFrag(media.currentTime));
      } else {
        return null;
      }
    }
  }, {
    key: 'nextLevel',
    get: function get() {
      var frag = this.nextBufferedFrag;
      if (frag) {
        return frag.level;
      } else {
        return -1;
      }
    }
  }, {
    key: 'liveSyncPosition',
    get: function get() {
      return this._liveSyncPosition;
    },
    set: function set(value) {
      this._liveSyncPosition = value;
    }
  }]);

  return StreamController;
}(_eventHandler2.default);

exports.default = StreamController;