//! The machine's own network addresses, for phones at home: on the local
//! network, and on Tailscale. Container and VM bridges aren't reachable from a phone.
use std::ffi::CStr;
use std::net::Ipv4Addr;

pub fn addresses() -> (Vec<String>, Vec<String>) {
    let (mut lan, mut tailscale) = (vec![], vec![]);
    let mut first: *mut libc::ifaddrs = std::ptr::null_mut();
    // SAFETY: getifaddrs gives a list that stays valid until freeifaddrs, and
    // each address is read as IPv4 only when its family says so.
    unsafe {
        if libc::getifaddrs(&mut first) != 0 {
            return (lan, tailscale);
        }
        let mut at = first;
        while let Some(i) = at.as_ref() {
            at = i.ifa_next;
            if i.ifa_addr.is_null() || (*i.ifa_addr).sa_family as i32 != libc::AF_INET || i.ifa_flags & libc::IFF_LOOPBACK as u32 != 0 {
                continue;
            }
            let name = CStr::from_ptr(i.ifa_name).to_string_lossy();
            if ["docker", "br-", "veth", "virbr", "lxc", "cni", "flannel"].iter().any(|p| name.starts_with(p)) {
                continue;
            }
            let ip = Ipv4Addr::from(u32::from_be((*(i.ifa_addr as *const libc::sockaddr_in)).sin_addr.s_addr)).to_string();
            if name.starts_with("tailscale") { tailscale.push(ip) } else { lan.push(ip) }
        }
        libc::freeifaddrs(first);
    }
    (lan, tailscale)
}
