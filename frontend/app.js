import $ from 'jquery';
import 'babel-polyfill';

import favicon from './favicon';

const BUCKET_PREFIX = 'https://leancloud-status.s3.amazonaws.com';
const SERVICES = ['LeanStorage', 'LeanMessage', 'LeanPush', 'LeanAnalytics', 'LeanEngine', 'Website', 'Support'];
const NODES = ['cn-n1', 'us-w1', 'cn-e1'];
const CHECK_POINTS = ['cn-n1', 'us-w1', 'cn-e1'];
const DOWN_THRESHOLD = 0.6;
const AUTO_REFRESH = 30 * 1000;
const CURRENT_EVENT = 24 * 3600 * 1000;

const SERVICE_INFO = {
  LeanStorage: {
    name: '数据存储',
    icon: 'cloud-storage'
  },
  LeanMessage: {
    name: '实时消息',
    icon: 'chat'
  },
  LeanPush: {
    name: '消息推送',
    icon: 'push'
  },
  LeanAnalytics: {
    name: '应用统计',
    icon: 'chart-alt'
  },
  LeanEngine: {
    name: '云引擎',
    icon: 'cloud'
  },
  Website: {
    name: '网站',
    icon: 'home'
  },
  Support: {
    name: '技术支持',
    icon: 'checked'
  }
};

const STATUS_MAPPING = {
  success: {
    text: '正常',
    class: 'up'
  },
  warning: {
    text: '异常',
    class: 'warning'
  },
  timeout: {
    text: '超时',
    class: 'timeout'
  },
  error: {
    text: '故障',
    class: 'down'
  }
};

const state = {
  currentNode: 'cn-n1',
  status: [],
  events: []
};

$( () => {
  function refresh() {
    loadLatestStatus().then( result => {
      state.status = mergeStatusCheckPoints(result)
      $('#status-root').html(render());
    }).catch( err => {
      console.error(err);
      $('#status-root').html(render());
    });

    localStatusEvents().then( ({events}) => {
      state.events = events;
      $('#status-events').html(renderStatusEvents());
    }).catch( err => {
      console.error(err);
      $('#status-events').html(renderStatusEvents());
    });
  }

  refresh();
  setInterval(refresh, AUTO_REFRESH);

  $('.nav-tabs.nodes a').click(function(event) {
    event.preventDefault();
    state.currentNode = $(this).data('target');
    $('.nav-tabs.nodes li.active').toggleClass('active');
    $(this).parent('li').toggleClass('active');
    $('#status-root').html(render());
  });
});

function loadLatestStatus() {
  return Promise.all(CHECK_POINTS.map( nodeName => {
    return $.getJSON(`${BUCKET_PREFIX}/${nodeName}-latest.json`).then( result => {
      return Object.assign(result, {nodeName});
    });
  }));
}

function localStatusEvents() {
  return $.getJSON(`${BUCKET_PREFIX}/events.json`);
}

function render() {
  return SERVICES.map( serviceName => {
    const statusItem = state.status.find( ({nodeName, service}) => {
      return nodeName === state.currentNode && service === serviceName;
    });

    const statusTitle = statusItem.checkResult.map( ({nodeName, error, latency}) => {
      return `${nodeName}: ${latency}ms, ${error ? error : 'success'}`;
    }).join('\n');

    const timestampTitle = statusItem.checkResult.map( ({nodeName, time}) => {
      return `${nodeName}: ${minuteAgo(new Date(time))}`;
    }).join('\n');

    return `
      <div class='col-xs-6'>
        <div class='status-block loaded ${STATUS_MAPPING[statusItem.status].class}'>
          <i class='icon icon-${SERVICE_INFO[serviceName].icon}'></i>
          <div class='status-title font-logo' title='${SERVICE_INFO[serviceName].name}'>${serviceName}</div>
          <div class='status-meta' id='data-status'>
            <p class='label' title='${statusTitle}'>${STATUS_MAPPING[statusItem.status].text}</p>
            <p class='timestamp' title='${timestampTitle}'>${minuteAgo(new Date(statusItem.lastSuccess))}</p>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderStatusEvents() {
  const currentEvents = [];
  var inProgress = false;

  for (let event of state.events) {
    if (Date.now() - new Date(event.time).getTime() > CURRENT_EVENT && !inProgress) {
      break;
    }

    if (event.inProgress) {
      inProgress = true;
    } else if (event.type === 'success') {
      inProgress = false;
    }

    currentEvents.push(event);
  }

  return currentEvents.map( ({content, type, time}) => {
    return `
      <p class='col-sm-12'>
        <span class='${type}'>${content}</span> <br /> <span class='date'>${time}</span>
      </p>
    `;
  }).join('');
}

function renderEventHistory() {

}

function mergeStatusCheckPoints(checkPointsResult) {
  var result = [];
  var overallStatus = 'success';

  for (let nodeName of NODES) {
    for (let service of SERVICES) {
      let checkResult = checkPointsResult.map( checkPoint => {
        return Object.assign(checkPoint.status[nodeName][service], {nodeName: checkPoint.nodeName});
      });

      checkResult.sort( (a, b) => {
        return new Date(b.time) - new Date(a.time);
      });

      let successResult = checkResult.filter( ({error}) => {
        return !error;
      });

      let failedResult = checkResult.filter( ({error}) => {
        return error;
      });

      let upRatio = 1 - (failedResult.length / NODES.length);

      result.push({
        nodeName: nodeName,
        service: service,
        error: failedResult[0] ? failedResult[0].error : null,
        upRatio: upRatio,
        checkResult: checkResult,
        lastSuccess: successResult[0].time,
        status: ( () => {
          if (upRatio === 1) {
            return 'success';
          } else if ((1 - upRatio) < DOWN_THRESHOLD) {
            if (failedResult.every( ({timeout}) => {
              return timeout;
            })) {
              return 'timeout';
            } else {
              return 'warning';
            }
          } else {
            return 'error';
          }
        })()
      });
    }
  }

  for ({status} of result) {
    if (['warning', 'timeout'].includes(status) && overallStatus !== 'error'){
      overallStatus = 'warning';
    } else if (status === 'error') {
      overallStatus = 'error';
    }
  }

  updateFavicon(overallStatus);

  return result;
}

function updateFavicon(type) {
  if (type === 'success') {
    favicon.change('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAMAAABg3Am1AAAAMFBMVEUAAAAfwR8fwR8fwR8ewh4fwh8AqgAfwR+K34ql5qWi5aLS8tL////6/fohwiEgwiACOoErAAAACHRSTlMAOq7o/f8GjPiGxicAAABxSURBVHja7daxDoAwCEVRKFDUqv3/vxUnky71xcSlvftZeVDESdS6qSSmu+xqL1PPAdyAnIgVAcqUDCqRYEBIMaBkYJ/BskYbAMoeHRNMMMHg4HyqXdBUBgBWm+Dr/T+AJwseRXh24WFHXwf8OYHfnwsTcTOGPp9qywAAAABJRU5ErkJggg==');
    $('body').removeClass().addClass('status status-up');
  } else if (type === 'warning') {
    favicon.change('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAMAAABg3Am1AAAAM1BMVEUAAAD/owD/owD/owD/ogD/owD/gAD/ogD/z3r/2pn/2Zb/7Mz//////fr/pAP/owL/owGl71DWAAAACHRSTlMAOq7o/f8GjPiGxicAAABxSURBVHgB7dY1AgMxFENB2ZaW6f6XXWjCpDBN/8oPmIWYqLOYYsAiy6kLMc/mIJchBwJlYECUJSLJkkBZCJluDopyVhlB3czaf/AP/sGPB91af0mwqf6BYOh3DP72fnpAWWgfRfvs+ofdfh3858R8fyY/qDOchDKCNwAAAABJRU5ErkJggg==');
    $('body').removeClass().addClass('status status-partial');
  } else if (type === 'error') {
    favicon.change('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAMAAABg3Am1AAAAM1BMVEUAAAD/ADn/ADz/ADz/ADz/AD3/ACv/ADz/epn/mbH/lq//zNj/////+vv/Az//Aj7/AT0xAGOBAAAACHRSTlMAOq7o/f8GjPiGxicAAABxSURBVHgB7dY1AgMxFENB2ZaW6f6XXWjCpDBN/8oPmIWYqLOYYsAiy6kLMc/mIJchBwJlYECUJSLJkkBZCJluDopyVhlB3czaf/AP/sGPB91af0mwqf6BYOh3DP72fnpAWWgfRfvs+ofdfh3858R8fyY/qDOchDKCNwAAAABJRU5ErkJggg==');
    $('body').removeClass().addClass('status status-down');
  }
}

function minuteAgo(time) {
  const milliseconds = Date.now() - time.getTime();
  const minutes = Math.floor(milliseconds / 1000 / 60);
  return minutes === 0 ? '刚刚' : `${Math.floor(milliseconds / 1000 / 60)} 分钟前`;
}